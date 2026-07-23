import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..ai.autoeval import run_auto_eval
from ..db import get_db
from ..deps import require_staff
from ..models import (
    AiMessage,
    Assessment,
    AssessmentProblem,
    Attempt,
    AttemptProblemState,
    Evaluation,
    Event,
    Execution,
    Problem,
    User,
)
from ..schemas import (
    AiMessageOut,
    EvaluationIn,
    EvaluationOut,
    EventOut,
    ReviewAttemptRow,
)

router = APIRouter(prefix="/review", tags=["review"])


@router.get("/attempts", response_model=list[ReviewAttemptRow])
async def list_attempts(
    assessment_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_staff),
):
    q = (
        select(Attempt)
        .options(selectinload(Attempt.user), selectinload(Attempt.assessment))
        .order_by(Attempt.started_at.desc())
    )
    if assessment_id:
        q = q.where(Attempt.assessment_id == assessment_id)
    attempts = (await db.execute(q)).scalars().all()

    rows = []
    for at in attempts:
        aps = (
            await db.execute(
                select(AssessmentProblem).where(AssessmentProblem.assessment_id == at.assessment_id)
            )
        ).scalars().all()
        max_score = float(sum(ap.points for ap in aps))
        total = 0.0
        for ap in aps:
            best = (
                await db.execute(
                    select(func.max(Execution.score)).where(
                        Execution.attempt_id == at.id,
                        Execution.problem_id == ap.problem_id,
                        Execution.kind == "submit",
                    )
                )
            ).scalar()
            if best:
                total += best / 100.0 * ap.points
        event_count = (
            await db.execute(select(func.count(Event.id)).where(Event.attempt_id == at.id))
        ).scalar() or 0
        ai_count = (
            await db.execute(select(func.count(AiMessage.id)).where(AiMessage.attempt_id == at.id))
        ).scalar() or 0
        has_auto = (
            await db.execute(
                select(func.count(Evaluation.id)).where(
                    Evaluation.attempt_id == at.id, Evaluation.kind == "auto"
                )
            )
        ).scalar() or 0
        rows.append(
            ReviewAttemptRow(
                id=at.id,
                assessment_id=at.assessment_id,
                assessment_title=at.assessment.title,
                mode=at.assessment.mode,
                candidate_name=at.user.name,
                candidate_email=at.user.email,
                status=at.status,
                started_at=at.started_at,
                submitted_at=at.submitted_at,
                total_score=round(total, 1),
                max_score=max_score,
                event_count=event_count,
                ai_message_count=ai_count,
                has_auto_eval=has_auto > 0,
                is_staff=at.user.role != "candidate",
            )
        )
    return rows


@router.get("/attempts/{attempt_id}")
async def attempt_detail(attempt_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_staff)):
    attempt = (
        await db.execute(
            select(Attempt)
            .where(Attempt.id == attempt_id)
            .options(selectinload(Attempt.user), selectinload(Attempt.assessment))
        )
    ).scalar_one_or_none()
    if not attempt:
        raise HTTPException(404, "응시 정보를 찾을 수 없습니다")

    aps = (
        await db.execute(
            select(AssessmentProblem)
            .where(AssessmentProblem.assessment_id == attempt.assessment_id)
            .options(selectinload(AssessmentProblem.problem).selectinload(Problem.test_cases))
            .order_by(AssessmentProblem.ordinal)
        )
    ).scalars().all()
    states = (
        await db.execute(select(AttemptProblemState).where(AttemptProblemState.attempt_id == attempt_id))
    ).scalars().all()
    events = (
        await db.execute(select(Event).where(Event.attempt_id == attempt_id).order_by(Event.created_at, Event.id))
    ).scalars().all()
    executions = (
        await db.execute(
            select(Execution).where(Execution.attempt_id == attempt_id).order_by(Execution.created_at)
        )
    ).scalars().all()
    ai_messages = (
        await db.execute(
            select(AiMessage).where(AiMessage.attempt_id == attempt_id).order_by(AiMessage.created_at)
        )
    ).scalars().all()
    evaluations = (
        await db.execute(
            select(Evaluation)
            .where(Evaluation.attempt_id == attempt_id)
            .options(selectinload(Evaluation.evaluator))
            .order_by(Evaluation.created_at.desc())
        )
    ).scalars().all()

    state_by_problem = {s.problem_id: s for s in states}
    problems = []
    for ap in aps:
        p = ap.problem
        submits = [e for e in executions if e.problem_id == p.id and e.kind == "submit" and e.score is not None]
        best = max(submits, key=lambda e: e.score, default=None)
        state = state_by_problem.get(p.id)
        problems.append(
            {
                "id": str(p.id),
                "title": p.title,
                "difficulty": p.difficulty,
                "points": ap.points,
                "statement_md": p.statement_md,
                "best_score": best.score if best else None,
                "best_verdict": best.verdict if best else None,
                "final_language": state.language if state else None,
                "final_code": state.code if state else None,
                "test_cases": [
                    {
                        "id": str(tc.id),
                        "ordinal": tc.ordinal,
                        "is_sample": tc.is_sample,
                        "weight": tc.weight,
                        "input": tc.input,
                        "expected_output": tc.expected_output,
                    }
                    for tc in p.test_cases
                ],
            }
        )

    return {
        "attempt": {
            "id": str(attempt.id),
            "status": attempt.status,
            "started_at": attempt.started_at.isoformat(),
            "deadline_at": attempt.deadline_at.isoformat(),
            "submitted_at": attempt.submitted_at.isoformat() if attempt.submitted_at else None,
        },
        "candidate": {"name": attempt.user.name, "email": attempt.user.email},
        "assessment": {
            "id": str(attempt.assessment_id),
            "title": attempt.assessment.title,
            "mode": attempt.assessment.mode,
            "duration_min": attempt.assessment.duration_min,
        },
        "problems": problems,
        "events": [EventOut.model_validate(e).model_dump(mode="json") for e in events],
        "executions": [
            {
                "id": str(e.id),
                "problem_id": str(e.problem_id),
                "kind": e.kind,
                "language": e.language,
                "status": e.status,
                "verdict": e.verdict,
                "score": e.score,
                "compile_output": e.compile_output,
                "code": e.code,
                "results": e.results or [],
                "created_at": e.created_at.isoformat(),
                "finished_at": e.finished_at.isoformat() if e.finished_at else None,
            }
            for e in executions
        ],
        "ai_messages": [AiMessageOut.model_validate(m).model_dump(mode="json") for m in ai_messages],
        "evaluations": [_eval_out(ev) for ev in evaluations],
    }


@router.post("/attempts/{attempt_id}/autoeval")
async def trigger_autoeval(attempt_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_staff)):
    attempt = await db.get(Attempt, attempt_id)
    if not attempt:
        raise HTTPException(404, "응시 정보를 찾을 수 없습니다")
    try:
        evaluation = await run_auto_eval(attempt, db)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return _eval_out(evaluation)


@router.post("/attempts/{attempt_id}/evaluations")
async def create_evaluation(
    attempt_id: uuid.UUID,
    body: EvaluationIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    attempt = await db.get(Attempt, attempt_id)
    if not attempt:
        raise HTTPException(404, "응시 정보를 찾을 수 없습니다")
    evaluation = Evaluation(
        attempt_id=attempt_id, kind="human", evaluator_id=user.id, scores=body.scores, summary=body.summary
    )
    db.add(evaluation)
    await db.commit()
    await db.refresh(evaluation, ["evaluator"])
    return _eval_out(evaluation)


def _eval_out(ev: Evaluation) -> dict:
    return EvaluationOut(
        id=ev.id,
        kind=ev.kind,
        evaluator_id=ev.evaluator_id,
        evaluator_name=ev.evaluator.name if ev.evaluator else None,
        scores=ev.scores,
        summary=ev.summary,
        created_at=ev.created_at,
    ).model_dump(mode="json")
