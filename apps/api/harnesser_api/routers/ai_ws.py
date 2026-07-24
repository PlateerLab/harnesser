"""AI 어시스턴트 WebSocket — 동형 봉투 프로토콜.

서버→클라이언트 봉투(모두 seq 부여):
  ready       {usage, configured, model, provider}
  turn_start  {req_id, problem_id, replay?}
  delta       {req_id, text}
  turn_end    {req_id, message_id, error, cancelled, usage}
  error       {req_id?, code, message}
  pong        {}

클라이언트→서버:
  chat   {req_id, problem_id, content}
  cancel {}
  ping   {}

생성은 chat_service의 소켓 독립 태스크에서 실행되므로 연결이 끊겨도
계속되며, 재접속 시 진행 중 턴의 버퍼를 리플레이한 뒤 이어 스트리밍한다.
"""

import asyncio
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..ai import chat_service
from ..ai import provider as ai_provider
from ..db import SessionLocal
from ..models import Assessment, Attempt
from ..security import COOKIE_NAME, decode_token

router = APIRouter()


class Envelope:
    """seq 부여 + 동시 전송 직렬화."""

    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.seq = 0
        self.lock = asyncio.Lock()

    async def send(self, event: dict) -> None:
        async with self.lock:
            self.seq += 1
            await self.ws.send_json({**event, "seq": self.seq})


async def _pump(queue: asyncio.Queue, out: Envelope) -> None:
    """턴 구독 큐 → 소켓. turn_end에서 종료."""
    while True:
        event = await queue.get()
        await out.send(event)
        if event.get("type") == "turn_end":
            return


async def _usage_snapshot(attempt_id: uuid.UUID, assessment: Assessment) -> dict:
    async with SessionLocal() as db:
        used = await chat_service.used_turns(db, attempt_id)
        res = await ai_provider.resolve_ai(db, "chat", override_provider_id=assessment.ai_provider_id)
    return {
        "usage": {
            "used": used,
            "max": assessment.ai_max_turns,
            "remaining": max(0, assessment.ai_max_turns - used),
        },
        "configured": bool(res and res.configured),
        "model": res.model if res else None,
        "provider": res.provider if res else None,
    }


@router.websocket("/attempts/{attempt_id}/ai/ws")
async def ai_ws(ws: WebSocket, attempt_id: uuid.UUID):
    # 인증: 쿠키(동일 오리진) 또는 ?token=
    token = ws.cookies.get(COOKIE_NAME) or ws.query_params.get("token", "")
    payload = decode_token(token) if token else None
    if not payload:
        await ws.close(code=4401)
        return
    user_id = uuid.UUID(payload["sub"])

    async with SessionLocal() as db:
        attempt = await db.get(Attempt, attempt_id)
        assessment = await db.get(Assessment, attempt.assessment_id) if attempt else None
    if (
        not attempt
        or attempt.user_id != user_id
        or not assessment
        or assessment.mode != "ai_assisted"
    ):
        await ws.close(code=4403)
        return

    await ws.accept()
    out = Envelope(ws)
    active_now = chat_service.active_turn(attempt_id)
    await out.send(
        {
            "type": "ready",
            **(await _usage_snapshot(attempt_id, assessment)),
            # 클라이언트 재접속 동기화용 — 진행 중 턴이 없으면 대기 상태를 해제한다
            "active_req_id": active_now.req_id if active_now and not active_now.done else None,
        }
    )

    pump_task: asyncio.Task | None = None
    subscribed: tuple[chat_service.TurnHandle, asyncio.Queue] | None = None

    def _swap_pump(handle: chat_service.TurnHandle, queue: asyncio.Queue) -> None:
        nonlocal pump_task, subscribed
        if pump_task:
            pump_task.cancel()
        if subscribed:
            subscribed[0].unsubscribe(subscribed[1])
        subscribed = (handle, queue)
        pump_task = asyncio.create_task(_pump(queue, out))

    # 진행 중 턴이 있으면 리플레이 후 이어서 스트리밍
    active = chat_service.active_turn(attempt_id)
    if active and not active.done:
        queue = active.subscribe()
        await out.send(
            {
                "type": "turn_start",
                "req_id": active.req_id,
                "problem_id": str(active.problem_id) if active.problem_id else None,
                "replay": True,
            }
        )
        accumulated = active.text()
        if accumulated:
            await out.send({"type": "delta", "req_id": active.req_id, "text": accumulated})
        if active.done:
            # 구독 직후 완료된 레이스 — 종료 봉투를 직접 송신
            await out.send(
                {
                    "type": "turn_end",
                    "req_id": active.req_id,
                    "message_id": active.assistant_message_id,
                    "error": active.error,
                    "cancelled": active.cancelled,
                    "usage": active.usage,
                }
            )
        else:
            _swap_pump(active, queue)

    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get("type")

            if msg_type == "ping":
                await out.send({"type": "pong"})
                continue

            if msg_type == "cancel":
                chat_service.cancel_turn(attempt_id)
                continue

            if msg_type == "chat":
                req_id = str(data.get("req_id") or uuid.uuid4())
                content = str(data.get("content") or "").strip()[:32000]
                if not content:
                    await out.send({"type": "error", "req_id": req_id, "code": 400, "message": "내용이 비어 있습니다"})
                    continue
                problem_id: uuid.UUID | None = None
                if data.get("problem_id"):
                    try:
                        problem_id = uuid.UUID(str(data["problem_id"]))
                    except ValueError:
                        pass
                try:
                    handle = await chat_service.start_turn(attempt_id, user_id, problem_id, content, req_id)
                except chat_service.ChatError as e:
                    await out.send({"type": "error", "req_id": req_id, "code": e.code, "message": e.message})
                    continue
                queue = handle.subscribe()
                await out.send(
                    {
                        "type": "turn_start",
                        "req_id": req_id,
                        "problem_id": str(problem_id) if problem_id else None,
                    }
                )
                _swap_pump(handle, queue)
                continue

            await out.send({"type": "error", "code": 400, "message": f"알 수 없는 메시지: {msg_type}"})
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 — 연결 종료로 수렴
        pass
    finally:
        if pump_task:
            pump_task.cancel()
        if subscribed:
            subscribed[0].unsubscribe(subscribed[1])
