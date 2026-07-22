import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_db
from ..deps import get_current_user
from ..judge.queue import enqueue_execution
from ..models import AssessmentProblem, Event, Execution, Problem, TestCase, User
from ..schemas import LANGUAGES, ExecutionIn, ExecutionOut, TestResultOut
from .attempts import get_attempt_for

router = APIRouter(tags=["executions"])

MAX_PENDING = 3  # 시도당 동시 대기 실행 수 제한


@router.post("/attempts/{attempt_id}/executions", response_model=ExecutionOut)
async def create_execution(
    attempt_id: uuid.UUID,
    body: ExecutionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    attempt = await get_attempt_for(attempt_id, user, db)
    if attempt.user_id != user.id:
        raise HTTPException(403, "본인의 응시에서만 실행할 수 있습니다")
    if attempt.status != "in_progress":
        raise HTTPException(400, "이미 종료된 시험입니다")
    if body.language not in LANGUAGES:
        raise HTTPException(400, "지원하지 않는 언어입니다")
    if len(body.code.encode()) > settings.max_code_bytes:
        raise HTTPException(400, "코드가 너무 깁니다 (최대 128KB)")

    in_assessment = (
        await db.execute(
            select(AssessmentProblem).where(
                AssessmentProblem.assessment_id == attempt.assessment_id,
                AssessmentProblem.problem_id == body.problem_id,
            )
        )
    ).scalar_one_or_none()
    if not in_assessment:
        raise HTTPException(400, "이 시험에 포함되지 않은 문제입니다")

    pending = (
        await db.execute(
            select(Execution).where(
                Execution.attempt_id == attempt_id,
                Execution.status.in_(["queued", "running"]),
            )
        )
    ).scalars().all()
    if len(pending) >= MAX_PENDING:
        raise HTTPException(429, "이전 실행이 끝날 때까지 기다려주세요")

    problem = await db.get(Problem, body.problem_id)
    tests_q = select(TestCase).where(TestCase.problem_id == body.problem_id).order_by(TestCase.ordinal)
    if body.kind == "run":
        tests_q = tests_q.where(TestCase.is_sample.is_(True))
    tests = (await db.execute(tests_q)).scalars().all()
    if not tests:
        raise HTTPException(400, "실행할 테스트 케이스가 없습니다")

    execution = Execution(
        attempt_id=attempt_id,
        problem_id=body.problem_id,
        user_id=user.id,
        kind=body.kind,
        language=body.language,
        code=body.code,
    )
    db.add(execution)
    await db.flush()
    db.add(
        Event(
            attempt_id=attempt_id,
            problem_id=body.problem_id,
            type=f"{body.kind}_requested",
            payload={"execution_id": str(execution.id), "language": body.language},
        )
    )
    await db.commit()

    await enqueue_execution(
        execution_id=str(execution.id),
        language=body.language,
        code=body.code,
        time_limit_ms=problem.time_limit_ms,
        memory_limit_mb=problem.memory_limit_mb,
        tests=[{"id": str(t.id), "input": t.input, "expected": t.expected_output} for t in tests],
    )
    return await _execution_out(execution, user, db)


@router.get("/executions/{execution_id}", response_model=ExecutionOut)
async def get_execution(
    execution_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    execution = await db.get(Execution, execution_id)
    if not execution:
        raise HTTPException(404, "실행 정보를 찾을 수 없습니다")
    if user.role == "candidate" and execution.user_id != user.id:
        raise HTTPException(403, "본인의 실행만 볼 수 있습니다")
    return await _execution_out(execution, user, db)


async def _execution_out(execution: Execution, user: User, db: AsyncSession) -> ExecutionOut:
    """결과 직렬화. 응시자에게는 히든 테스트의 입출력을 가린다."""
    tests = (
        await db.execute(
            select(TestCase).where(TestCase.problem_id == execution.problem_id).order_by(TestCase.ordinal)
        )
    ).scalars().all()
    test_by_id = {str(t.id): t for t in tests}
    is_staff = user.role in ("admin", "evaluator")

    results: list[TestResultOut] = []
    passed = 0
    for r in execution.results or []:
        tc = test_by_id.get(r.get("test_id", ""))
        if tc is None:
            continue
        verdict = r.get("verdict", "IE")
        if verdict == "AC":
            passed += 1
        reveal = is_staff or tc.is_sample
        results.append(
            TestResultOut(
                test_id=str(tc.id),
                ordinal=tc.ordinal,
                is_sample=tc.is_sample,
                verdict=verdict,
                time_ms=r.get("time_ms"),
                input=tc.input if reveal else None,
                expected_output=tc.expected_output if reveal else None,
                stdout=r.get("stdout") if reveal else None,
                stderr=r.get("stderr") if reveal else None,
            )
        )

    total = len(execution.results or []) or (
        len([t for t in tests if t.is_sample]) if execution.kind == "run" else len(tests)
    )
    return ExecutionOut(
        id=execution.id,
        problem_id=execution.problem_id,
        kind=execution.kind,
        language=execution.language,
        status=execution.status,
        verdict=execution.verdict,
        score=execution.score,
        compile_output=execution.compile_output,
        created_at=execution.created_at,
        finished_at=execution.finished_at,
        results=results,
        passed=passed,
        total=total,
        code=execution.code if is_staff else None,
    )
