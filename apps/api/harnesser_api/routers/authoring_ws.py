"""문제 작성 에이전트 WebSocket — 관리자 전용.

서버→클라이언트: ready | assistant_text | tool_call {call_id,name,input}
                | turn_end {req_id,error} | error | pong   (모두 seq 부여)
클라이언트→서버: chat {req_id, content, provider_id, active_tab, tab_context}
                | tool_result {call_id, result} | ping

도구 실행은 전부 클라이언트(초안 소유자)에 위임되고, 서버는 스키마 검증과
LLM 루프만 담당한다. DB에는 어떤 도구도 쓰지 않는다.
"""

import asyncio
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..ai import authoring
from ..ai import provider as ai_provider
from ..db import SessionLocal
from ..models import AiProvider
from ..security import COOKIE_NAME, decode_token

router = APIRouter()

TOOL_TIMEOUT_S = 30.0


class Envelope:
    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.seq = 0
        self.lock = asyncio.Lock()

    async def send(self, event: dict) -> None:
        async with self.lock:
            self.seq += 1
            await self.ws.send_json({**event, "seq": self.seq})


@router.websocket("/authoring/ws")
async def authoring_ws(ws: WebSocket):
    token = ws.cookies.get(COOKIE_NAME) or ws.query_params.get("token", "")
    payload = decode_token(token) if token else None
    if not payload or payload.get("role") != "admin":
        await ws.close(code=4403)
        return

    await ws.accept()
    out = Envelope(ws)

    async with SessionLocal() as db:
        default_res = await ai_provider.resolve_ai(db, "chat")
    await out.send(
        {
            "type": "ready",
            "configured": bool(default_res and default_res.configured),
            "model": default_res.model if default_res else None,
        }
    )

    messages: list[dict] = []  # canonical 대화 이력 (연결 단위)
    pending_tools: dict[str, asyncio.Future] = {}
    turn_task: asyncio.Task | None = None

    async def request_tool(call_id: str, name: str, tool_input: dict) -> str:
        """클라이언트에 도구 실행을 위임하고 결과를 기다린다."""
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        pending_tools[call_id] = future
        try:
            await out.send({"type": "tool_call", "call_id": call_id, "name": name, "input": tool_input})
            return str(await asyncio.wait_for(future, timeout=TOOL_TIMEOUT_S))
        except asyncio.TimeoutError:
            return "실패 — 도구 실행 시간 초과(클라이언트 응답 없음)"
        finally:
            pending_tools.pop(call_id, None)

    async def run_chat(req_id: str, content: str, provider_id: str, active_tab: str, tab_context: str):
        nonlocal messages
        try:
            res = None
            if provider_id:
                async with SessionLocal() as db:
                    row = await db.get(AiProvider, uuid.UUID(provider_id))
                if row and row.enabled:
                    res = ai_provider.resolved_from_row(row)
            if res is None:
                async with SessionLocal() as db:
                    res = await ai_provider.resolve_ai(db, "chat")
            if res is None or not res.configured:
                await out.send({"type": "error", "req_id": req_id, "code": 503, "message": "사용 가능한 LLM 공급자가 없습니다"})
                return

            note = authoring.build_context_note(active_tab, tab_context)
            messages.append({"role": "user", "content": f"{note}\n\n{content}"})
            messages = authoring.trim_history(messages)
            # run_turn은 assistant/tool_result 메시지를 messages에 이어 붙인다
            error = None
            try:
                await authoring.run_turn(res, messages, req_id, out.send, request_tool)
            except Exception as e:  # noqa: BLE001 — 공급자 오류를 봉투로 전달
                error = str(e)[:600]
            await out.send({"type": "turn_end", "req_id": req_id, "error": error})
        except Exception as e:  # noqa: BLE001
            await out.send({"type": "turn_end", "req_id": req_id, "error": str(e)[:600]})

    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get("type")

            if msg_type == "ping":
                await out.send({"type": "pong"})
                continue

            if msg_type == "tool_result":
                future = pending_tools.get(str(data.get("call_id")))
                if future and not future.done():
                    future.set_result(str(data.get("result", ""))[:authoring.MAX_TOOL_RESULT_CHARS])
                continue

            if msg_type == "chat":
                req_id = str(data.get("req_id") or uuid.uuid4())
                if turn_task and not turn_task.done():
                    await out.send({"type": "error", "req_id": req_id, "code": 409, "message": "이미 작업이 진행 중입니다"})
                    continue
                content = str(data.get("content") or "").strip()[:32000]
                if not content:
                    await out.send({"type": "error", "req_id": req_id, "code": 400, "message": "내용이 비어 있습니다"})
                    continue
                turn_task = asyncio.create_task(
                    run_chat(
                        req_id,
                        content,
                        str(data.get("provider_id") or ""),
                        str(data.get("active_tab") or "basic"),
                        str(data.get("tab_context") or ""),
                    )
                )
                continue

            await out.send({"type": "error", "code": 400, "message": f"알 수 없는 메시지: {msg_type}"})
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 — 연결 종료로 수렴
        pass
    finally:
        if turn_task and not turn_task.done():
            turn_task.cancel()
        for future in pending_tools.values():
            if not future.done():
                future.cancel()
