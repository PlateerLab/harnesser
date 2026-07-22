import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import settings
from ..db import get_db
from ..deps import get_current_user
from ..models import (
    Assessment,
    AssessmentProblem,
    Assignment,
    Attempt,
    AttemptProblemState,
    Event,
    Problem,
    User,
    utcnow,
)
from ..schemas import (
    AttemptOut,
    AttemptProblemOut,
    EventBatchIn,
    MyAssignmentOut,
    SampleCase,
)

router = APIRouter(tags=["attempts"])

# 마감 후에도 이벤트 플러시가 도착할 수 있는 유예 시간
DEADLINE_GRACE = timedelta(seconds=45)


async def check_expired(attempt: Attempt, db: AsyncSession) -> Attempt:
    """마감이 지난 진행중 시도를 자동 만료 처리."""
    if attempt.status == "in_progress" and utcnow() > attempt.deadline_at + DEADLINE_GRACE:
        attempt.status = "expired"
        attempt.submitted_at = attempt.deadline_at
        db.add(Event(attempt_id=attempt.id, type="attempt_expired", payload={}))
        await db.commit()
    return attempt


async def get_attempt_for(attempt_id: uuid.UUID, user: User, db: AsyncSession) -> Attempt:
    attempt = await db.get(Attempt, attempt_id)
    if not attempt:
        raise HTTPException(404, "응시 정보를 찾을 수 없습니다")
    if user.role == "candidate" and attempt.user_id != user.id:
        raise HTTPException(403, "본인의 응시만 볼 수 있습니다")
    return await check_expired(attempt, db)


@router.get("/my/assignments", response_model=list[MyAssignmentOut])
async def my_assignments(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(Assignment)
            .where(Assignment.user_id == user.id)
            .options(selectinload(Assignment.assessment).selectinload(Assessment.problems))
            .order_by(Assignment.created_at.desc())
        )
    ).scalars().all()
    attempts = (
        await db.execute(select(Attempt).where(Attempt.user_id == user.id))
    ).scalars().all()
    for at in attempts:
        await check_expired(at, db)
    attempt_by_assessment = {at.assessment_id: at for at in attempts}
    out = []
    for asg in rows:
        a = asg.assessment
        at = attempt_by_assessment.get(a.id)
        out.append(
            MyAssignmentOut(
                assessment_id=a.id,
                title=a.title,
                description=a.description,
                mode=a.mode,
                duration_min=a.duration_min,
                starts_at=a.starts_at,
                ends_at=a.ends_at,
                problem_count=len(a.problems),
                attempt_id=at.id if at else None,
                attempt_status=at.status if at else None,
            )
        )
    return out


@router.post("/assessments/{assessment_id}/attempts", response_model=AttemptOut)
async def start_attempt(
    assessment_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    assignment = (
        await db.execute(
            select(Assignment).where(
                Assignment.assessment_id == assessment_id, Assignment.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if not assignment:
        raise HTTPException(403, "이 시험에 배정되지 않았습니다")

    assessment = await db.get(Assessment, assessment_id)
    now = utcnow()
    if assessment.starts_at and now < assessment.starts_at:
        raise HTTPException(400, "아직 시험 시작 시간이 아닙니다")
    if assessment.ends_at and now > assessment.ends_at:
        raise HTTPException(400, "시험 응시 기간이 종료되었습니다")

    existing = (
        await db.execute(
            select(Attempt).where(Attempt.assessment_id == assessment_id, Attempt.user_id == user.id)
        )
    ).scalar_one_or_none()
    if existing:
        await check_expired(existing, db)
        if existing.status != "in_progress":
            raise HTTPException(400, "이미 종료된 시험입니다")
        return await _attempt_out(existing, db)

    deadline = now + timedelta(minutes=assessment.duration_min)
    if assessment.ends_at and deadline > assessment.ends_at:
        deadline = assessment.ends_at
    attempt = Attempt(assessment_id=assessment_id, user_id=user.id, started_at=now, deadline_at=deadline)
    db.add(attempt)
    await db.flush()
    db.add(
        Event(
            attempt_id=attempt.id,
            type="attempt_started",
            payload={"assessment_id": str(assessment_id), "deadline_at": deadline.isoformat()},
        )
    )
    await db.commit()
    return await _attempt_out(attempt, db)


@router.get("/attempts/{attempt_id}", response_model=AttemptOut)
async def get_attempt(
    attempt_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    attempt = await get_attempt_for(attempt_id, user, db)
    return await _attempt_out(attempt, db)


@router.post("/attempts/{attempt_id}/events")
async def post_events(
    attempt_id: uuid.UUID,
    body: EventBatchIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    attempt = await get_attempt_for(attempt_id, user, db)
    if attempt.user_id != user.id:
        raise HTTPException(403, "본인의 응시에만 기록할 수 있습니다")
    if attempt.status != "in_progress":
        # 종료 직후 플러시는 조용히 무시 (클라이언트 큐 잔여분)
        return {"ok": True, "recorded": 0}
    events = body.events[: settings.max_event_batch]
    for ev in events:
        db.add(Event(attempt_id=attempt.id, problem_id=ev.problem_id, type=ev.type, payload=ev.payload))
        if ev.type == "code_snapshot" and ev.problem_id:
            await _upsert_state(attempt.id, ev.problem_id, ev.payload, db)
    await db.commit()
    return {"ok": True, "recorded": len(events)}


@router.post("/attempts/{attempt_id}/finish", response_model=AttemptOut)
async def finish_attempt(
    attempt_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    attempt = await get_attempt_for(attempt_id, user, db)
    if attempt.user_id != user.id:
        raise HTTPException(403, "본인의 응시만 종료할 수 있습니다")
    if attempt.status == "in_progress":
        attempt.status = "submitted"
        attempt.submitted_at = utcnow()
        db.add(Event(attempt_id=attempt.id, type="attempt_finished", payload={}))
        await db.commit()
    return await _attempt_out(attempt, db)


async def _upsert_state(attempt_id: uuid.UUID, problem_id: uuid.UUID, payload: dict, db: AsyncSession):
    code = str(payload.get("code", ""))[: settings.max_code_bytes]
    language = str(payload.get("language", "python"))[:20]
    state = (
        await db.execute(
            select(AttemptProblemState).where(
                AttemptProblemState.attempt_id == attempt_id,
                AttemptProblemState.problem_id == problem_id,
            )
        )
    ).scalar_one_or_none()
    if state:
        state.code = code
        state.language = language
        state.updated_at = utcnow()
    else:
        db.add(
            AttemptProblemState(attempt_id=attempt_id, problem_id=problem_id, language=language, code=code)
        )


async def _attempt_out(attempt: Attempt, db: AsyncSession) -> AttemptOut:
    assessment = (
        await db.execute(
            select(Assessment)
            .where(Assessment.id == attempt.assessment_id)
            .options(
                selectinload(Assessment.problems)
                .selectinload(AssessmentProblem.problem)
                .selectinload(Problem.test_cases)
            )
        )
    ).scalar_one()
    states = (
        await db.execute(select(AttemptProblemState).where(AttemptProblemState.attempt_id == attempt.id))
    ).scalars().all()
    state_by_problem = {s.problem_id: s for s in states}

    problems = []
    for ap in assessment.problems:
        p = ap.problem
        state = state_by_problem.get(p.id)
        problems.append(
            AttemptProblemOut(
                id=p.id,
                ordinal=ap.ordinal,
                points=ap.points,
                title=p.title,
                statement_md=p.statement_md,
                difficulty=p.difficulty,
                time_limit_ms=p.time_limit_ms,
                memory_limit_mb=p.memory_limit_mb,
                starter_code=p.starter_code or {},
                samples=[
                    SampleCase(input=tc.input, expected_output=tc.expected_output)
                    for tc in p.test_cases
                    if tc.is_sample
                ],
                saved_language=state.language if state else None,
                saved_code=state.code if state else None,
            )
        )
    remaining = max(0, int((attempt.deadline_at - utcnow()).total_seconds())) if attempt.status == "in_progress" else 0
    return AttemptOut(
        id=attempt.id,
        assessment_id=assessment.id,
        assessment_title=assessment.title,
        mode=assessment.mode,
        status=attempt.status,
        started_at=attempt.started_at,
        deadline_at=attempt.deadline_at,
        remaining_seconds=remaining,
        problems=problems,
    )
