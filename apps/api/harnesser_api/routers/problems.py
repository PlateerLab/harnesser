import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..db import get_db
from ..deps import require_admin, require_staff
from ..models import Problem, TestCase, User
from ..schemas import ProblemIn, ProblemOut, ProblemSummary

router = APIRouter(prefix="/problems", tags=["problems"])


@router.get("", response_model=list[ProblemSummary])
async def list_problems(db: AsyncSession = Depends(get_db), _=Depends(require_staff)):
    rows = (
        await db.execute(
            select(Problem, func.count(TestCase.id))
            .outerjoin(TestCase)
            .where(Problem.is_archived.is_(False))
            .group_by(Problem.id)
            .order_by(Problem.created_at.desc())
        )
    ).all()
    return [
        ProblemSummary(
            id=p.id, title=p.title, difficulty=p.difficulty, test_case_count=c, created_at=p.created_at
        )
        for p, c in rows
    ]


@router.post("", response_model=ProblemOut)
async def create_problem(body: ProblemIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    problem = Problem(
        title=body.title,
        statement_md=body.statement_md,
        difficulty=body.difficulty,
        time_limit_ms=body.time_limit_ms,
        memory_limit_mb=body.memory_limit_mb,
        starter_code=body.starter_code,
        created_by=user.id,
    )
    for i, tc in enumerate(body.test_cases):
        problem.test_cases.append(
            TestCase(
                ordinal=i,
                input=tc.input,
                expected_output=tc.expected_output,
                is_sample=tc.is_sample,
                weight=tc.weight,
            )
        )
    db.add(problem)
    await db.commit()
    return await _load(problem.id, db)


@router.get("/{problem_id}", response_model=ProblemOut)
async def get_problem(problem_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_staff)):
    return await _load(problem_id, db)


@router.put("/{problem_id}", response_model=ProblemOut)
async def update_problem(
    problem_id: uuid.UUID, body: ProblemIn, db: AsyncSession = Depends(get_db), _=Depends(require_admin)
):
    problem = await _load(problem_id, db)
    problem.title = body.title
    problem.statement_md = body.statement_md
    problem.difficulty = body.difficulty
    problem.time_limit_ms = body.time_limit_ms
    problem.memory_limit_mb = body.memory_limit_mb
    problem.starter_code = body.starter_code
    problem.test_cases.clear()
    for i, tc in enumerate(body.test_cases):
        problem.test_cases.append(
            TestCase(
                ordinal=i,
                input=tc.input,
                expected_output=tc.expected_output,
                is_sample=tc.is_sample,
                weight=tc.weight,
            )
        )
    await db.commit()
    return await _load(problem_id, db)


@router.delete("/{problem_id}")
async def delete_problem(problem_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    problem = await db.get(Problem, problem_id)
    if not problem:
        raise HTTPException(404, "문제를 찾을 수 없습니다")
    problem.is_archived = True
    await db.commit()
    return {"ok": True}


async def _load(problem_id: uuid.UUID, db: AsyncSession) -> Problem:
    problem = (
        await db.execute(
            select(Problem).where(Problem.id == problem_id).options(selectinload(Problem.test_cases))
        )
    ).scalar_one_or_none()
    if not problem or problem.is_archived:
        raise HTTPException(404, "문제를 찾을 수 없습니다")
    return problem
