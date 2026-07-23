import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai import provider
from ..config import settings
from ..db import SessionLocal, get_db
from ..deps import get_current_user
from ..models import AiMessage, Assessment, Event, Problem, User
from ..schemas import AiChatIn, AiMessageOut
from .attempts import get_attempt_for

router = APIRouter(tags=["ai"])

SYSTEM_PROMPT = """당신은 코딩 테스트 응시자를 돕는 AI 어시스턴트입니다.
응시자가 문제를 이해하고, 접근 방법을 설계하고, 코드를 작성하는 것을 자유롭게 도와주세요.
코드 예시는 markdown 코드 블록으로 제공하세요.
모든 대화는 평가 목적으로 기록됩니다."""


@router.get("/ai/status")
async def ai_status(_: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    cfg = await provider.get_ai_config(db)
    return {"configured": cfg.configured, "model": cfg.chat_model}


async def _used_turns(attempt_id: uuid.UUID, db: AsyncSession) -> int:
    """소진한 질문 턴 수 — 공급자 오류로 응답을 전혀 못 받은 턴(meta.failed)은 제외."""
    return (
        await db.execute(
            select(func.count(AiMessage.id)).where(
                AiMessage.attempt_id == attempt_id,
                AiMessage.role == "user",
                ~AiMessage.meta.contains({"failed": True}),
            )
        )
    ).scalar() or 0


@router.get("/attempts/{attempt_id}/ai/usage")
async def ai_usage(
    attempt_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    attempt = await get_attempt_for(attempt_id, user, db)
    assessment = await db.get(Assessment, attempt.assessment_id)
    used = await _used_turns(attempt_id, db)
    return {
        "enabled": assessment.mode == "ai_assisted",
        "used": used,
        "max": assessment.ai_max_turns,
        "remaining": max(0, assessment.ai_max_turns - used),
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
    cfg = await provider.get_ai_config(db)
    if not cfg.configured:
        raise HTTPException(503, "AI가 설정되지 않았습니다. 관리자에게 문의하세요 (관리자 콘솔 > 설정)")

    # 컨텍스트 구성: 시스템 + 문제 지문 + 이전 대화 + 새 메시지
    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    if body.problem_id:
        problem = await db.get(Problem, body.problem_id)
        if problem:
            messages.append(
                {"role": "system", "content": f"현재 문제: {problem.title}\n\n{problem.statement_md[:6000]}"}
            )
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

    async def event_stream():
        parts: list[str] = []
        error: str | None = None
        try:
            async for delta in provider.stream_chat(cfg, messages):
                parts.append(delta)
                yield f"data: {json.dumps({'delta': delta}, ensure_ascii=False)}\n\n"
        except Exception as e:  # noqa: BLE001 — 오류도 응답으로 전달
            error = str(e)
            yield f"data: {json.dumps({'error': error}, ensure_ascii=False)}\n\n"
        content = "".join(parts)
        # 스트리밍 완료 후 별도 세션으로 기록 (응답 생명주기와 분리)
        if content or error:
            async with SessionLocal() as s:
                msg = AiMessage(
                    attempt_id=attempt_id,
                    problem_id=problem_id,
                    role="assistant",
                    content=content,
                    model=cfg.chat_model,
                    meta={"error": error} if error else {},
                )
                s.add(msg)
                s.add(
                    Event(
                        attempt_id=attempt_id,
                        problem_id=problem_id,
                        type="ai_message",
                        payload={"role": "assistant", "chars": len(content), "error": error},
                    )
                )
                if error and not content:
                    # 응답을 전혀 받지 못한 턴은 소진 턴에서 제외(환불)
                    failed_user_msg = await s.get(AiMessage, user_msg_id)
                    if failed_user_msg:
                        failed_user_msg.meta = {**(failed_user_msg.meta or {}), "failed": True}
                await s.commit()
                yield f"data: {json.dumps({'done': True, 'message_id': str(msg.id)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
