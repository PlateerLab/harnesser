import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="candidate")  # admin | evaluator | candidate
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Problem(Base):
    __tablename__ = "problems"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200))
    statement_md: Mapped[str] = mapped_column(Text, default="")
    difficulty: Mapped[str] = mapped_column(String(20), default="medium")  # easy | medium | hard
    time_limit_ms: Mapped[int] = mapped_column(Integer, default=2000)
    memory_limit_mb: Mapped[int] = mapped_column(Integer, default=256)
    starter_code: Mapped[dict] = mapped_column(JSONB, default=dict)  # {language: code}
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    test_cases: Mapped[list["TestCase"]] = relationship(
        back_populates="problem", cascade="all, delete-orphan", order_by="TestCase.ordinal"
    )


class TestCase(Base):
    __tablename__ = "test_cases"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    problem_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("problems.id", ondelete="CASCADE"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer, default=0)
    input: Mapped[str] = mapped_column(Text, default="")
    expected_output: Mapped[str] = mapped_column(Text, default="")
    is_sample: Mapped[bool] = mapped_column(Boolean, default=False)
    weight: Mapped[int] = mapped_column(Integer, default=1)

    problem: Mapped[Problem] = relationship(back_populates="test_cases")


class Assessment(Base):
    __tablename__ = "assessments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    mode: Mapped[str] = mapped_column(String(20), default="standard")  # standard | ai_assisted
    duration_min: Mapped[int] = mapped_column(Integer, default=90)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    problems: Mapped[list["AssessmentProblem"]] = relationship(
        back_populates="assessment", cascade="all, delete-orphan", order_by="AssessmentProblem.ordinal"
    )
    assignments: Mapped[list["Assignment"]] = relationship(
        back_populates="assessment", cascade="all, delete-orphan"
    )


class AssessmentProblem(Base):
    __tablename__ = "assessment_problems"
    __table_args__ = (UniqueConstraint("assessment_id", "problem_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    assessment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assessments.id", ondelete="CASCADE"), index=True)
    problem_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("problems.id", ondelete="CASCADE"))
    ordinal: Mapped[int] = mapped_column(Integer, default=0)
    points: Mapped[int] = mapped_column(Integer, default=100)

    assessment: Mapped[Assessment] = relationship(back_populates="problems")
    problem: Mapped[Problem] = relationship()


class Assignment(Base):
    __tablename__ = "assignments"
    __table_args__ = (UniqueConstraint("assessment_id", "user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    assessment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assessments.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    assessment: Mapped[Assessment] = relationship(back_populates="assignments")
    user: Mapped[User] = relationship()


class Attempt(Base):
    __tablename__ = "attempts"
    __table_args__ = (UniqueConstraint("assessment_id", "user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    assessment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assessments.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="in_progress")  # in_progress | submitted | expired
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    deadline_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    assessment: Mapped[Assessment] = relationship()
    user: Mapped[User] = relationship()


class AttemptProblemState(Base):
    """문제별 현재 에디터 상태 (스냅샷 이벤트로부터 upsert — 새로고침 복원 및 리뷰용 최종 코드)."""

    __tablename__ = "attempt_problem_states"
    __table_args__ = (UniqueConstraint("attempt_id", "problem_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    attempt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"), index=True)
    problem_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("problems.id", ondelete="CASCADE"))
    language: Mapped[str] = mapped_column(String(20), default="python")
    code: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Event(Base):
    """응시 중 발생한 모든 행동의 append-only 로그."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    attempt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"), index=True)
    problem_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    type: Mapped[str] = mapped_column(String(50), index=True)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Execution(Base):
    """코드 실행 요청 — kind=run(샘플 테스트) | submit(전체 채점)."""

    __tablename__ = "executions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    attempt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"), index=True)
    problem_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("problems.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(10))  # run | submit
    language: Mapped[str] = mapped_column(String(20))
    code: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | running | done | error
    verdict: Mapped[str | None] = mapped_column(String(10), nullable=True)  # AC WA CE RE TLE IE
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    compile_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    results: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # [{test_id, verdict, time_ms, stdout, stderr}]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AiMessage(Base):
    __tablename__ = "ai_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    attempt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"), index=True)
    problem_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    role: Mapped[str] = mapped_column(String(20))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class AppSetting(Base):
    """플랫폼 전역 설정 (key-value). 예: key='ai' → LLM 공급자 설정 (env보다 우선)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Evaluation(Base):
    __tablename__ = "evaluations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    attempt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10))  # auto | human
    evaluator_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    scores: Mapped[dict] = mapped_column(JSONB, default=dict)
    summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    evaluator: Mapped[User | None] = relationship()
