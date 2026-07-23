"""AI 채팅 턴 서비스 — 소켓 생명주기와 분리된 생성 실행기.

턴은 attempt당 하나만 동시 실행되며, WebSocket이 끊겨도 생성과 기록은
계속된다. 재접속한 소켓은 진행 중 턴을 구독해 지금까지의 버퍼를 리플레이
받고 이어서 스트리밍한다. (Geny 채팅 WS의 커서 리플레이를 턴 단위로 단순화)

단일 API 프로세스 가정 — 다중 레플리카로 확장하려면 레지스트리를
Redis pub/sub으로 교체해야 한다.
"""

import asyncio
import uuid
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import SessionLocal
from ..models import AiMessage, Assessment, Attempt, Event, Problem
from . import provider as ai_provider

SYSTEM_PROMPT = """당신은 코딩 테스트 응시자를 돕는 AI 어시스턴트입니다.
응시자가 문제를 이해하고, 접근 방법을 설계하고, 코드를 작성하는 것을 자유롭게 도와주세요.
코드 예시는 markdown 코드 블록으로 제공하세요.
모든 대화는 평가 목적으로 기록됩니다."""


class ChatError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


async def used_turns(db: AsyncSession, attempt_id: uuid.UUID) -> int:
    """소진한 질문 턴 수 — 응답을 전혀 못 받은 턴(meta.failed)은 제외."""
    return (
        await db.execute(
            select(func.count(AiMessage.id)).where(
                AiMessage.attempt_id == attempt_id,
                AiMessage.role == "user",
                ~AiMessage.meta.contains({"failed": True}),
            )
        )
    ).scalar() or 0


@dataclass
class TurnHandle:
    attempt_id: uuid.UUID
    req_id: str
    problem_id: uuid.UUID | None
    buffer: list[str] = field(default_factory=list)
    done: bool = False
    error: str | None = None
    cancelled: bool = False
    assistant_message_id: str | None = None
    usage: dict | None = None
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    task: asyncio.Task | None = None

    def text(self) -> str:
        return "".join(self.buffer)

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self.subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self.subscribers.discard(q)

    def publish(self, event: dict) -> None:
        for q in list(self.subscribers):
            q.put_nowait(event)


# attempt_id → 진행 중 턴 (동시 1개)
_ACTIVE: dict[uuid.UUID, TurnHandle] = {}


def active_turn(attempt_id: uuid.UUID) -> TurnHandle | None:
    return _ACTIVE.get(attempt_id)


async def start_turn(
    attempt_id: uuid.UUID,
    user_id: uuid.UUID,
    problem_id: uuid.UUID | None,
    content: str,
    req_id: str,
) -> TurnHandle:
    """검증 → 사용자 턴 기록 → 백그라운드 생성 태스크 시작."""
    if attempt_id in _ACTIVE:
        raise ChatError(409, "이미 응답이 진행 중입니다. 완료 후 다시 질문하세요")

    async with SessionLocal() as db:
        attempt = await db.get(Attempt, attempt_id)
        if not attempt or attempt.user_id != user_id:
            raise ChatError(403, "본인의 응시에서만 사용할 수 있습니다")
        if attempt.status != "in_progress":
            raise ChatError(400, "이미 종료된 시험입니다")
        assessment = await db.get(Assessment, attempt.assessment_id)
        if assessment.mode != "ai_assisted":
            raise ChatError(403, "이 시험에서는 AI를 사용할 수 없습니다")
        used = await used_turns(db, attempt_id)
        if used >= assessment.ai_max_turns:
            raise ChatError(429, f"AI 질문 한도({assessment.ai_max_turns}회)를 모두 사용했습니다")
        res = await ai_provider.resolve_ai(db, "chat", override_provider_id=assessment.ai_provider_id)
        if res is None or not res.configured:
            raise ChatError(503, "AI가 설정되지 않았습니다. 관리자에게 문의하세요 (관리자 콘솔 > 설정)")

        system_text = SYSTEM_PROMPT
        if problem_id:
            problem = await db.get(Problem, problem_id)
            if problem:
                system_text += f"\n\n현재 문제: {problem.title}\n\n{problem.statement_md[:6000]}"
        history_q = (
            select(AiMessage)
            .where(AiMessage.attempt_id == attempt_id)
            .order_by(AiMessage.created_at.desc())
            .limit(settings.ai_history_limit)
        )
        if problem_id:
            history_q = history_q.where(AiMessage.problem_id == problem_id)
        history = list(reversed((await db.execute(history_q)).scalars().all()))
        messages = [{"role": m.role, "content": m.content} for m in history]
        messages.append({"role": "user", "content": content})

        user_msg = AiMessage(attempt_id=attempt_id, problem_id=problem_id, role="user", content=content)
        db.add(user_msg)
        db.add(
            Event(
                attempt_id=attempt_id,
                problem_id=problem_id,
                type="ai_message",
                payload={"role": "user", "chars": len(content)},
            )
        )
        await db.commit()
        user_msg_id = user_msg.id
        max_turns = assessment.ai_max_turns

    handle = TurnHandle(attempt_id=attempt_id, req_id=req_id, problem_id=problem_id)
    _ACTIVE[attempt_id] = handle
    handle.task = asyncio.create_task(
        _generate(handle, res, messages, system_text, user_msg_id, max_turns)
    )
    return handle


async def _generate(
    handle: TurnHandle,
    res: ai_provider.ResolvedAi,
    messages: list[dict],
    system_text: str,
    user_msg_id: uuid.UUID,
    max_turns: int,
) -> None:
    error: str | None = None
    try:
        async for delta in ai_provider.stream_text(res, messages, system=system_text):
            handle.buffer.append(delta)
            handle.publish({"type": "delta", "req_id": handle.req_id, "text": delta})
    except asyncio.CancelledError:
        handle.cancelled = True
    except Exception as e:  # noqa: BLE001 — 오류를 봉투로 전달
        error = str(e)
    finally:
        handle.error = error
        # 영속화는 취소와 무관하게 독립 태스크로 보장 (재취소 레이스 회피)
        persist_task = asyncio.get_running_loop().create_task(
            _persist(handle, res, user_msg_id, max_turns, error)
        )
        try:
            handle.assistant_message_id, handle.usage = await asyncio.shield(persist_task)
        except BaseException:  # noqa: BLE001 — persist는 백그라운드에서 계속 완료된다
            pass
        handle.done = True
        handle.publish(
            {
                "type": "turn_end",
                "req_id": handle.req_id,
                "message_id": handle.assistant_message_id,
                "error": error,
                "cancelled": handle.cancelled,
                "usage": handle.usage,
            }
        )
        _ACTIVE.pop(handle.attempt_id, None)


async def _persist(
    handle: TurnHandle,
    res: ai_provider.ResolvedAi,
    user_msg_id: uuid.UUID,
    max_turns: int,
    error: str | None,
) -> tuple[str | None, dict]:
    content = handle.text()
    meta: dict = {"provider": res.provider, "provider_name": res.name}
    if error:
        meta["error"] = error
    if handle.cancelled:
        meta["cancelled"] = True
    async with SessionLocal() as s:
        msg = AiMessage(
            attempt_id=handle.attempt_id,
            problem_id=handle.problem_id,
            role="assistant",
            content=content,
            model=res.model,
            meta=meta,
        )
        s.add(msg)
        s.add(
            Event(
                attempt_id=handle.attempt_id,
                problem_id=handle.problem_id,
                type="ai_message",
                payload={
                    "role": "assistant",
                    "chars": len(content),
                    "error": error,
                    "cancelled": handle.cancelled,
                },
            )
        )
        if not content:
            # 응답을 전혀 받지 못한 턴은 소진 턴에서 제외(환불)
            failed_user_msg = await s.get(AiMessage, user_msg_id)
            if failed_user_msg:
                failed_user_msg.meta = {**(failed_user_msg.meta or {}), "failed": True}
        await s.commit()
        used = await used_turns(s, handle.attempt_id)
        usage = {"used": used, "max": max_turns, "remaining": max(0, max_turns - used)}
        return str(msg.id), usage


def cancel_turn(attempt_id: uuid.UUID) -> bool:
    handle = _ACTIVE.get(attempt_id)
    if handle and handle.task and not handle.done:
        handle.task.cancel()
        return True
    return False
