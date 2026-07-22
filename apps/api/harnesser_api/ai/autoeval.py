"""LLM 기반 응시 자동평가 — 최종 코드, 채점 결과, 행동 로그, AI 대화를 종합해 구조화 평가를 생성."""

import json
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
)
from . import provider

EVAL_PROMPT = """당신은 코딩 테스트 평가 전문가입니다. 아래 응시 데이터를 종합적으로 분석하고 평가하세요.

반드시 아래 JSON 형식만 출력하세요 (다른 텍스트 금지):
{
  "overall_score": <0-100 정수>,
  "criteria": {
    "correctness": <0-100, 정답성: 채점 결과 기반>,
    "code_quality": <0-100, 코드 품질: 가독성/구조/네이밍>,
    "process": <0-100, 문제 해결 과정: 스냅샷 흐름, 실행 패턴, 시간 배분>,
    "ai_utilization": <0-100 또는 null, AI 활용 시험일 때만: 질문의 질, 검증 태도, 맹목적 복붙 여부>
  },
  "summary": "<3~5문장 종합 평가 (한국어)>",
  "strengths": ["<강점>", ...],
  "concerns": ["<우려사항>", ...],
  "integrity_flags": ["<부정행위 의심 신호가 있으면 기술, 없으면 빈 배열>", ...]
}"""


async def build_context(attempt: Attempt, db: AsyncSession) -> str:
    assessment = await db.get(Assessment, attempt.assessment_id)
    aps = (
        await db.execute(
            select(AssessmentProblem).where(AssessmentProblem.assessment_id == assessment.id)
        )
    ).scalars().all()
    states = (
        await db.execute(select(AttemptProblemState).where(AttemptProblemState.attempt_id == attempt.id))
    ).scalars().all()
    state_by_problem = {s.problem_id: s for s in states}
    executions = (
        await db.execute(
            select(Execution).where(Execution.attempt_id == attempt.id).order_by(Execution.created_at)
        )
    ).scalars().all()
    events = (
        await db.execute(select(Event).where(Event.attempt_id == attempt.id))
    ).scalars().all()
    ai_messages = (
        await db.execute(
            select(AiMessage).where(AiMessage.attempt_id == attempt.id).order_by(AiMessage.created_at)
        )
    ).scalars().all()

    lines: list[str] = []
    lines.append(f"## 시험: {assessment.title} (모드: {assessment.mode}, 제한 {assessment.duration_min}분)")
    dur = (attempt.submitted_at or attempt.deadline_at) - attempt.started_at
    lines.append(f"응시 상태: {attempt.status}, 소요: {int(dur.total_seconds() // 60)}분")

    # 행동 통계
    pastes = [e for e in events if e.type == "paste"]
    focus_lost = [e for e in events if e.type == "focus_lost"]
    snapshots = [e for e in events if e.type == "code_snapshot"]
    lines.append(
        f"\n## 행동 로그 요약\n- 코드 스냅샷: {len(snapshots)}회\n- 붙여넣기: {len(pastes)}회 "
        f"(총 {sum(e.payload.get('chars', 0) for e in pastes)}자)\n- 창 이탈: {len(focus_lost)}회"
    )
    if pastes:
        big = sorted(pastes, key=lambda e: -e.payload.get("chars", 0))[:3]
        for e in big:
            text = str(e.payload.get("text", ""))[:300]
            lines.append(f"  - 붙여넣기 {e.payload.get('chars', 0)}자 예시: {text!r}")

    # 문제별 최종 코드와 채점
    for ap in aps:
        problem = await db.get(Problem, ap.problem_id)
        lines.append(f"\n## 문제: {problem.title} (배점 {ap.points})")
        lines.append(f"지문 요약: {problem.statement_md[:800]}")
        submits = [e for e in executions if e.problem_id == ap.problem_id and e.kind == "submit"]
        runs = [e for e in executions if e.problem_id == ap.problem_id and e.kind == "run"]
        best = max((s for s in submits if s.score is not None), key=lambda s: s.score, default=None)
        lines.append(f"실행 {len(runs)}회 / 제출 {len(submits)}회")
        if best:
            lines.append(f"최고 제출: {best.language}, verdict={best.verdict}, score={best.score}")
        state = state_by_problem.get(ap.problem_id)
        code = (best.code if best else (state.code if state else "")) or ""
        if code:
            lines.append(f"최종 코드:\n```\n{code[:4000]}\n```")
        else:
            lines.append("최종 코드 없음")

    # AI 대화
    if ai_messages:
        lines.append(f"\n## AI 대화 ({len(ai_messages)}턴)")
        transcript = []
        for m in ai_messages:
            role = "응시자" if m.role == "user" else "AI"
            transcript.append(f"[{role}] {m.content}")
        text = "\n\n".join(transcript)
        if len(text) > 12000:
            text = text[:6000] + "\n\n...(중략)...\n\n" + text[-6000:]
        lines.append(text)

    return "\n".join(lines)


def parse_eval_json(raw: str) -> dict:
    """모델 출력에서 JSON을 관대하게 추출."""
    raw = raw.strip()
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if m:
        raw = m.group(1)
    else:
        start, end = raw.find("{"), raw.rfind("}")
        if start >= 0 and end > start:
            raw = raw[start : end + 1]
    return json.loads(raw)


async def run_auto_eval(attempt: Attempt, db: AsyncSession) -> Evaluation:
    if not provider.is_configured():
        raise RuntimeError("AI가 설정되지 않았습니다 (AI_API_KEY)")
    context = await build_context(attempt, db)
    raw = await provider.complete_chat(
        [
            {"role": "system", "content": EVAL_PROMPT},
            {"role": "user", "content": context},
        ]
    )
    try:
        data = parse_eval_json(raw)
    except (json.JSONDecodeError, ValueError):
        data = {"overall_score": None, "criteria": {}, "summary": raw[:2000], "parse_error": True}

    evaluation = Evaluation(
        attempt_id=attempt.id,
        kind="auto",
        scores={
            "overall_score": data.get("overall_score"),
            "criteria": data.get("criteria", {}),
            "strengths": data.get("strengths", []),
            "concerns": data.get("concerns", []),
            "integrity_flags": data.get("integrity_flags", []),
        },
        summary=str(data.get("summary", ""))[:8000],
    )
    db.add(evaluation)
    await db.commit()
    await db.refresh(evaluation)
    return evaluation
