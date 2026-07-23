import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..db import get_db
from ..deps import require_admin, require_staff
from ..models import Assessment, AssessmentProblem, Assignment, Attempt, Problem, User
from ..schemas import (
    AssessmentIn,
    AssessmentOut,
    AssessmentProblemOut,
    AssignmentOut,
)

router = APIRouter(prefix="/assessments", tags=["assessments"])


async def _load(assessment_id: uuid.UUID, db: AsyncSession) -> Assessment:
    a = (
        await db.execute(
            select(Assessment)
            .where(Assessment.id == assessment_id)
            .options(
                selectinload(Assessment.problems).selectinload(AssessmentProblem.problem),
                selectinload(Assessment.assignments).selectinload(Assignment.user),
            )
        )
    ).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "시험을 찾을 수 없습니다")
    return a


async def _to_out(a: Assessment, db: AsyncSession) -> AssessmentOut:
    attempts = (
        await db.execute(select(Attempt).where(Attempt.assessment_id == a.id))
    ).scalars().all()
    attempt_by_user = {at.user_id: at for at in attempts}
    return AssessmentOut(
        id=a.id,
        title=a.title,
        description=a.description,
        mode=a.mode,
        duration_min=a.duration_min,
        ai_max_turns=a.ai_max_turns,
        ai_provider_id=a.ai_provider_id,
        starts_at=a.starts_at,
        ends_at=a.ends_at,
        created_at=a.created_at,
        problems=[
            AssessmentProblemOut(
                problem_id=ap.problem_id,
                title=ap.problem.title,
                difficulty=ap.problem.difficulty,
                ordinal=ap.ordinal,
                points=ap.points,
            )
            for ap in a.problems
        ],
        assignments=[
            AssignmentOut(
                user_id=asg.user_id,
                email=asg.user.email,
                name=asg.user.name,
                attempt_id=attempt_by_user[asg.user_id].id if asg.user_id in attempt_by_user else None,
                attempt_status=attempt_by_user[asg.user_id].status if asg.user_id in attempt_by_user else None,
            )
            for asg in a.assignments
        ],
    )


@router.get("", response_model=list[AssessmentOut])
async def list_assessments(db: AsyncSession = Depends(get_db), _=Depends(require_staff)):
    rows = (
        await db.execute(
            select(Assessment)
            .options(
                selectinload(Assessment.problems).selectinload(AssessmentProblem.problem),
                selectinload(Assessment.assignments).selectinload(Assignment.user),
            )
            .order_by(Assessment.created_at.desc())
        )
    ).scalars().all()
    return [await _to_out(a, db) for a in rows]


@router.post("", response_model=AssessmentOut)
async def create_assessment(body: AssessmentIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    a = Assessment(
        title=body.title,
        description=body.description,
        mode=body.mode,
        duration_min=body.duration_min,
        ai_max_turns=body.ai_max_turns,
        ai_provider_id=body.ai_provider_id,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        created_by=user.id,
        # 컬렉션을 미리 초기화 — db.get()의 autoflush로 INSERT된 뒤
        # 미로드 컬렉션에 접근하면 async 세션에서 lazy-load(MissingGreenlet)가 터진다
        problems=[],
        assignments=[],
    )
    db.add(a)
    await _apply_relations(a, body, db)
    await db.commit()
    return await _to_out(await _load(a.id, db), db)


@router.get("/{assessment_id}", response_model=AssessmentOut)
async def get_assessment(assessment_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_staff)):
    return await _to_out(await _load(assessment_id, db), db)


@router.put("/{assessment_id}", response_model=AssessmentOut)
async def update_assessment(
    assessment_id: uuid.UUID, body: AssessmentIn, db: AsyncSession = Depends(get_db), _=Depends(require_admin)
):
    a = await _load(assessment_id, db)
    a.title = body.title
    a.description = body.description
    a.mode = body.mode
    a.duration_min = body.duration_min
    a.ai_max_turns = body.ai_max_turns
    a.ai_provider_id = body.ai_provider_id
    a.starts_at = body.starts_at
    a.ends_at = body.ends_at
    a.problems.clear()
    # 기존 배정 중 빠진 사용자만 제거 (응시 이력 보존을 위해 남은 배정은 유지)
    keep = set(body.assignee_ids)
    a.assignments[:] = [asg for asg in a.assignments if asg.user_id in keep]
    await _apply_relations(a, body, db, existing_user_ids={asg.user_id for asg in a.assignments})
    await db.commit()
    return await _to_out(await _load(assessment_id, db), db)


@router.delete("/{assessment_id}")
async def delete_assessment(assessment_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    a = await db.get(Assessment, assessment_id)
    if not a:
        raise HTTPException(404, "시험을 찾을 수 없습니다")
    await db.delete(a)
    await db.commit()
    return {"ok": True}


async def _apply_relations(
    a: Assessment, body: AssessmentIn, db: AsyncSession, existing_user_ids: set | None = None
) -> None:
    existing_user_ids = existing_user_ids or set()
    seen: set[uuid.UUID] = set()
    ordinal = 0
    for ap in body.problems:
        if ap.problem_id in seen:
            continue
        seen.add(ap.problem_id)
        problem = await db.get(Problem, ap.problem_id)
        if not problem or problem.is_archived:
            raise HTTPException(400, f"존재하지 않는 문제입니다: {ap.problem_id}")
        a.problems.append(AssessmentProblem(problem_id=ap.problem_id, ordinal=ordinal, points=ap.points))
        ordinal += 1
    for user_id in body.assignee_ids:
        if user_id in existing_user_ids:
            continue
        user = await db.get(User, user_id)
        if not user:
            raise HTTPException(400, f"존재하지 않는 사용자입니다: {user_id}")
        a.assignments.append(Assignment(user_id=user_id))
        existing_user_ids.add(user_id)
