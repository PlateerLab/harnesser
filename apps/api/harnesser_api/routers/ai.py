import asyncio
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai import provider
from ..ai.chat_service import (
    MAX_TOOL_ITERATIONS,
    SYSTEM_PROMPT,
    build_reference_system_text,
    used_turns,
)
from ..problem_content import REFERENCE_TOOLS, execute_reference_tool
from ..config import settings
from ..db import SessionLocal, get_db
from ..deps import get_current_user
from ..models import AiMessage, Assessment, Event, Problem, User
from ..schemas import AiChatIn, AiMessageOut
from .attempts import get_attempt_for

router = APIRouter(tags=["ai"])


@router.get("/ai/status")
async def ai_status(_: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    res = await provider.resolve_ai(db, "chat")
    if res is None:
        return {"configured": False, "provider": None, "model": None, "name": None}
    return {"configured": res.configured, "provider": res.provider, "model": res.model, "name": res.name}


async def _used_turns(attempt_id: uuid.UUID, db: AsyncSession) -> int:
    return await used_turns(db, attempt_id)


@router.get("/attempts/{attempt_id}/ai/usage")
async def ai_usage(
    attempt_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    attempt = await get_attempt_for(attempt_id, user, db)
    assessment = await db.get(Assessment, attempt.assessment_id)
    used = await _used_turns(attempt_id, db)
    res = await provider.resolve_ai(db, "chat", override_provider_id=assessment.ai_provider_id)
    return {
        "enabled": assessment.mode == "ai_assisted",
        "used": used,
        "max": assessment.ai_max_turns,
        "remaining": max(0, assessment.ai_max_turns - used),
        "configured": bool(res and res.configured),
        "model": res.model if res else None,
        "provider": res.provider if res else None,
    }


@router.get("/attempts/{attempt_id}/ai/messages", response_model=list[AiMessageOut])
async def list_messages(
    attempt_id: uuid.UUID,
    problem_id: uuid.UUID | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_attempt_for(attempt_id, user, db)
    q = select(AiMessage).where(AiMessage.attempt_id == attempt_id).order_by(AiMessage.created_at)
    if problem_id:
        q = q.where(AiMessage.problem_id == problem_id)
    return (await db.execute(q)).scalars().all()


@router.post("/attempts/{attempt_id}/ai/chat")
async def chat(
    attempt_id: uuid.UUID,
    body: AiChatIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    attempt = await get_attempt_for(attempt_id, user, db)
    if attempt.user_id != user.id:
        raise HTTPException(403, "본인의 응시에서만 사용할 수 있습니다")
    if attempt.status != "in_progress":
        raise HTTPException(400, "이미 종료된 시험입니다")

    assessment = await db.get(Assessment, attempt.assessment_id)
    if assessment.mode != "ai_assisted":
        raise HTTPException(403, "이 시험에서는 AI를 사용할 수 없습니다")
    used = await _used_turns(attempt_id, db)
    if used >= assessment.ai_max_turns:
        raise HTTPException(429, f"AI 질문 한도({assessment.ai_max_turns}회)를 모두 사용했습니다")
    res = await provider.resolve_ai(db, "chat", override_provider_id=assessment.ai_provider_id)
    if res is None or not res.configured:
        raise HTTPException(503, "AI가 설정되지 않았습니다. 관리자에게 문의하세요 (관리자 콘솔 > 설정)")

    # 제로 컨텍스트: 지문은 주입하지 않되, 참고 자료가 있으면 열람 도구만 제공
    system_text = SYSTEM_PROMPT
    reference_files: list[dict] = []
    if body.problem_id:
        prob = await db.get(Problem, body.problem_id)
        if prob and prob.reference_files:
            reference_files = list(prob.reference_files)
            system_text += build_reference_system_text(res, reference_files)
    messages: list[dict] = []
    history_q = (
        select(AiMessage)
        .where(AiMessage.attempt_id == attempt_id)
        .order_by(AiMessage.created_at.desc())
        .limit(settings.ai_history_limit)
    )
    if body.problem_id:
        history_q = history_q.where(AiMessage.problem_id == body.problem_id)
    history = list(reversed((await db.execute(history_q)).scalars().all()))
    for m in history:
        messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": body.content})

    # 사용자 메시지는 스트리밍 전에 먼저 기록 (실패해도 질문은 남도록)
    user_msg = AiMessage(
        attempt_id=attempt_id, problem_id=body.problem_id, role="user", content=body.content
    )
    db.add(user_msg)
    db.add(
        Event(
            attempt_id=attempt_id,
            problem_id=body.problem_id,
            type="ai_message",
            payload={"role": "user", "chars": len(body.content)},
        )
    )
    await db.commit()

    problem_id = body.problem_id
    user_msg_id = user_msg.id
    chat_model = res.model
    provider_meta = {"provider": res.provider, "provider_name": res.name}

    async def persist(content: str, error: str | None, disconnected: bool = False) -> str | None:
        """응답 생명주기와 분리된 세션으로 어시스턴트 턴을 영속화.

        클라이언트가 새로고침/이탈로 끊겨도 받은 만큼은 저장하고,
        아무 응답도 받지 못한 턴은 meta.failed로 표시해 소진 턴에서 제외한다.
        """
        meta: dict = dict(provider_meta)
        if error:
            meta["error"] = error
        if disconnected:
            meta["disconnected"] = True
        async with SessionLocal() as s:
            msg = AiMessage(
                attempt_id=attempt_id,
                problem_id=problem_id,
                role="assistant",
                content=content,
                model=chat_model,
                meta=meta,
            )
            s.add(msg)
            s.add(
                Event(
                    attempt_id=attempt_id,
                    problem_id=problem_id,
                    type="ai_message",
                    payload={
                        "role": "assistant",
                        "chars": len(content),
                        "error": error,
                        "disconnected": disconnected,
                    },
                )
            )
            if not content:
                failed_user_msg = await s.get(AiMessage, user_msg_id)
                if failed_user_msg:
                    failed_user_msg.meta = {**(failed_user_msg.meta or {}), "failed": True}
            await s.commit()
            return str(msg.id)

    async def reference_tool_stream():
        """SSE에서의 참고 자료 도구 루프 — delta/tool 이벤트를 순서대로 yield."""
        client = provider.build_client(res)
        for _ in range(MAX_TOOL_ITERATIONS):
            response = await client.create_message(
                model_config=provider._model_config(res),
                messages=messages,
                system=system_text,
                tools=REFERENCE_TOOLS,
                purpose="harnesser.chat.reference",
            )
            text = (response.text or "").strip()
            tool_calls = response.tool_calls
            if text:
                yield ("delta", text)
            if not tool_calls:
                messages.append({"role": "assistant", "content": text or "(응답 없음)"})
                return
            ac: list[dict] = ([{"type": "text", "text": text}] if text else []) + [
                {"type": "tool_use", "id": b.tool_use_id, "name": b.tool_name, "input": b.tool_input or {}}
                for b in tool_calls
            ]
            messages.append({"role": "assistant", "content": ac})
            results = []
            for b in tool_calls:
                out = execute_reference_tool(b.tool_name, b.tool_input or {}, reference_files)
                detail = str((b.tool_input or {}).get("path", "")) if b.tool_name == "read_reference_file" else "목록"
                yield ("tool", {"name": b.tool_name, "detail": detail})
                results.append({"type": "tool_result", "tool_use_id": b.tool_use_id, "content": str(out)[:24000]})
            messages.append({"role": "user", "content": results})

    async def event_stream():
        parts: list[str] = []
        error: str | None = None
        persisted = False
        try:
            try:
                # 도구 루프는 호스트 도구 지원 공급자에서만 — CLI 계열은 자료가
                # system_text에 인라인되어 있어 일반 스트리밍으로 흐른다.
                if reference_files and provider.supports_host_tools(res):
                    async for kind, payload in reference_tool_stream():
                        if kind == "delta":
                            parts.append(payload)
                            yield f"data: {json.dumps({'delta': payload}, ensure_ascii=False)}\n\n"
                        else:
                            yield f"data: {json.dumps({'tool': payload}, ensure_ascii=False)}\n\n"
                else:
                    async for delta in provider.stream_text(res, messages, system=system_text):
                        parts.append(delta)
                        yield f"data: {json.dumps({'delta': delta}, ensure_ascii=False)}\n\n"
            except Exception as e:  # noqa: BLE001 — 오류도 응답으로 전달
                error = str(e)
                yield f"data: {json.dumps({'error': error}, ensure_ascii=False)}\n\n"
            msg_id = await persist("".join(parts), error)
            persisted = True
            yield f"data: {json.dumps({'done': True, 'message_id': msg_id})}\n\n"
        finally:
            if not persisted:
                # 클라이언트 이탈로 스트림이 취소된 경우 — 독립 태스크로 저장을 보장
                asyncio.get_running_loop().create_task(
                    persist("".join(parts), error, disconnected=True)
                )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
