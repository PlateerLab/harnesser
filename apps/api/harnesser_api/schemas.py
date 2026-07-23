import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field

Role = Literal["admin", "evaluator", "candidate"]
Language = Literal["python", "cpp", "java", "go"]
Mode = Literal["standard", "ai_assisted"]

LANGUAGES: list[str] = ["python", "cpp", "java", "go"]


# ── auth / users ─────────────────────────────────────────────


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    role: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=6)
    role: Role = "candidate"


class UserUpdate(BaseModel):
    name: str | None = None
    password: str | None = Field(default=None, min_length=6)
    role: Role | None = None
    is_active: bool | None = None


# ── problems ─────────────────────────────────────────────────


class TestCaseIn(BaseModel):
    input: str = ""
    expected_output: str = ""
    is_sample: bool = False
    weight: int = Field(default=1, ge=1, le=100)


class TestCaseOut(TestCaseIn):
    id: uuid.UUID
    ordinal: int

    model_config = {"from_attributes": True}


class ProblemIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    statement_md: str = ""
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    time_limit_ms: int = Field(default=2000, ge=100, le=30000)
    memory_limit_mb: int = Field(default=256, ge=16, le=2048)
    starter_code: dict[str, str] = {}
    test_cases: list[TestCaseIn] = []


class ProblemOut(BaseModel):
    id: uuid.UUID
    title: str
    statement_md: str
    difficulty: str
    time_limit_ms: int
    memory_limit_mb: int
    starter_code: dict[str, str]
    created_at: datetime
    updated_at: datetime
    test_cases: list[TestCaseOut] = []

    model_config = {"from_attributes": True}


class ProblemSummary(BaseModel):
    id: uuid.UUID
    title: str
    difficulty: str
    test_case_count: int = 0
    created_at: datetime


# ── assessments ──────────────────────────────────────────────


class AssessmentProblemIn(BaseModel):
    problem_id: uuid.UUID
    points: int = Field(default=100, ge=0, le=1000)


class AssessmentIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    mode: Mode = "standard"
    duration_min: int = Field(default=90, ge=5, le=600)
    ai_max_turns: int = Field(default=20, ge=0, le=500)  # ai_assisted 모드의 응시당 질문 한도
    ai_provider_id: uuid.UUID | None = None  # 시험 전용 LLM 공급자 (없으면 기본)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    problems: list[AssessmentProblemIn] = []
    assignee_ids: list[uuid.UUID] = []


class AssessmentProblemOut(BaseModel):
    problem_id: uuid.UUID
    title: str
    difficulty: str
    ordinal: int
    points: int


class AssignmentOut(BaseModel):
    user_id: uuid.UUID
    email: str
    name: str
    attempt_id: uuid.UUID | None = None
    attempt_status: str | None = None


class AssessmentOut(BaseModel):
    id: uuid.UUID
    title: str
    description: str
    mode: str
    duration_min: int
    ai_max_turns: int = 20
    ai_provider_id: uuid.UUID | None = None
    starts_at: datetime | None
    ends_at: datetime | None
    created_at: datetime
    problems: list[AssessmentProblemOut] = []
    assignments: list[AssignmentOut] = []


# ── candidate ────────────────────────────────────────────────


class MyAssignmentOut(BaseModel):
    assessment_id: uuid.UUID
    title: str
    description: str
    mode: str
    duration_min: int
    starts_at: datetime | None
    ends_at: datetime | None
    problem_count: int
    attempt_id: uuid.UUID | None = None
    attempt_status: str | None = None
    assigned: bool = True  # 스태프 미리보기 목록에서는 미배정 시험도 노출


class AiProviderIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    provider: str = Field(max_length=30)
    base_url: str | None = Field(default=None, max_length=500)
    api_key: str | None = None  # None=기존 유지, ""=삭제
    model: str = Field(min_length=1, max_length=200)
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    max_tokens: int = Field(default=4096, ge=256, le=128000)
    enabled: bool = True


class AiProviderOut(BaseModel):
    id: uuid.UUID
    name: str
    provider: str
    base_url: str | None
    model: str
    temperature: float
    max_tokens: int
    enabled: bool
    is_chat_default: bool
    is_eval_default: bool
    has_key: bool = False
    key_hint: str | None = None
    created_at: datetime


class AiDefaultsIn(BaseModel):
    chat_provider_id: uuid.UUID | None = None
    eval_provider_id: uuid.UUID | None = None


class AiTestIn(BaseModel):
    """연결 테스트 — provider_id가 있으면 저장된 키/설정 위에 덮어쓴 값으로 테스트."""

    provider_id: uuid.UUID | None = None
    provider: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None


class SampleCase(BaseModel):
    input: str
    expected_output: str


class AttemptProblemOut(BaseModel):
    id: uuid.UUID
    ordinal: int
    points: int
    title: str
    statement_md: str
    difficulty: str
    time_limit_ms: int
    memory_limit_mb: int
    starter_code: dict[str, str]
    samples: list[SampleCase]
    saved_language: str | None = None
    saved_code: str | None = None
    saved_code_by_lang: dict[str, str] = {}


class AttemptOut(BaseModel):
    id: uuid.UUID
    assessment_id: uuid.UUID
    assessment_title: str
    mode: str
    status: str
    started_at: datetime
    deadline_at: datetime
    remaining_seconds: int
    problems: list[AttemptProblemOut] = []


class StateIn(BaseModel):
    """에디터 상태 저장 (새로고침/이탈 복원용). sendBeacon 호환을 위해 POST."""

    problem_id: uuid.UUID
    language: str = Field(max_length=20)
    code_by_lang: dict[str, str] = {}


class ExecutionSummary(BaseModel):
    id: uuid.UUID
    problem_id: uuid.UUID
    kind: str
    language: str
    status: str
    verdict: str | None
    score: float | None
    passed: int = 0
    total: int = 0
    created_at: datetime


class EventIn(BaseModel):
    type: str = Field(min_length=1, max_length=50)
    problem_id: uuid.UUID | None = None
    payload: dict[str, Any] = {}


class EventBatchIn(BaseModel):
    events: list[EventIn]


class ExecutionIn(BaseModel):
    problem_id: uuid.UUID
    kind: Literal["run", "submit"]
    language: Language
    code: str


class TestResultOut(BaseModel):
    test_id: str
    ordinal: int
    is_sample: bool
    verdict: str
    time_ms: int | None = None
    input: str | None = None
    expected_output: str | None = None
    stdout: str | None = None
    stderr: str | None = None


class ExecutionOut(BaseModel):
    id: uuid.UUID
    problem_id: uuid.UUID
    kind: str
    language: str
    status: str
    verdict: str | None
    score: float | None
    compile_output: str | None
    created_at: datetime
    finished_at: datetime | None
    results: list[TestResultOut] = []
    passed: int = 0
    total: int = 0
    code: str | None = None


# ── AI ───────────────────────────────────────────────────────


class AiChatIn(BaseModel):
    problem_id: uuid.UUID | None = None
    content: str = Field(min_length=1, max_length=32000)


class AiMessageOut(BaseModel):
    id: uuid.UUID
    problem_id: uuid.UUID | None
    role: str
    content: str
    model: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── review ───────────────────────────────────────────────────


class EventOut(BaseModel):
    id: int
    problem_id: uuid.UUID | None
    type: str
    payload: dict
    created_at: datetime

    model_config = {"from_attributes": True}


class EvaluationIn(BaseModel):
    scores: dict[str, Any] = {}
    summary: str = ""


class EvaluationOut(BaseModel):
    id: uuid.UUID
    kind: str
    evaluator_id: uuid.UUID | None
    evaluator_name: str | None = None
    scores: dict
    summary: str
    created_at: datetime


class ReviewAttemptRow(BaseModel):
    id: uuid.UUID
    assessment_id: uuid.UUID
    assessment_title: str
    mode: str
    candidate_name: str
    candidate_email: str
    status: str
    started_at: datetime
    submitted_at: datetime | None
    total_score: float | None = None
    max_score: float | None = None
    event_count: int = 0
    ai_message_count: int = 0
    has_auto_eval: bool = False
    is_staff: bool = False  # 관리자/평가자의 체험 응시


class InternalTestResult(BaseModel):
    test_id: str
    verdict: str
    time_ms: int | None = None
    stdout: str | None = None
    stderr: str | None = None


class InternalResultIn(BaseModel):
    status: Literal["done", "error"]
    verdict: str | None = None
    compile_output: str | None = None
    results: list[InternalTestResult] = []
