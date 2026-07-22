import uuid

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_db
from ..models import Event, Execution, TestCase, utcnow
from ..schemas import InternalResultIn

router = APIRouter(prefix="/internal", tags=["internal"])


def check_internal(x_internal_token: str = Header(default="")):
    if x_internal_token != settings.internal_token:
        raise HTTPException(401, "invalid internal token")


@router.post("/executions/{execution_id}/result", dependencies=[Depends(check_internal)])
async def report_result(execution_id: uuid.UUID, body: InternalResultIn, db: AsyncSession = Depends(get_db)):
    execution = await db.get(Execution, execution_id)
    if not execution:
        raise HTTPException(404, "execution not found")

    execution.status = body.status
    execution.verdict = body.verdict
    execution.compile_output = body.compile_output
    execution.results = [r.model_dump() for r in body.results]
    execution.finished_at = utcnow()

    # 제출 채점이면 가중치 기반 점수 산출 (0~100)
    if execution.kind == "submit" and body.status == "done":
        tests = (
            await db.execute(select(TestCase).where(TestCase.problem_id == execution.problem_id))
        ).scalars().all()
        weight_by_id = {str(t.id): t.weight for t in tests}
        total_w = sum(weight_by_id.get(r.test_id, 0) for r in body.results)
        passed_w = sum(weight_by_id.get(r.test_id, 0) for r in body.results if r.verdict == "AC")
        execution.score = round(100.0 * passed_w / total_w, 2) if total_w else 0.0

    db.add(
        Event(
            attempt_id=execution.attempt_id,
            problem_id=execution.problem_id,
            type=f"{execution.kind}_result",
            payload={
                "execution_id": str(execution.id),
                "verdict": execution.verdict,
                "score": execution.score,
                "language": execution.language,
            },
        )
    )
    await db.commit()
    return {"ok": True}


@router.post("/executions/{execution_id}/running", dependencies=[Depends(check_internal)])
async def mark_running(execution_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    execution = await db.get(Execution, execution_id)
    if execution and execution.status == "queued":
        execution.status = "running"
        await db.commit()
    return {"ok": True}
