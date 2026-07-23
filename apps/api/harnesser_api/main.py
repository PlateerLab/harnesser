import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .config import settings
from .db import Base, SessionLocal, engine
from .routers import (
    ai,
    assessments,
    attempts,
    auth,
    executions,
    internal,
    problems,
    review,
    settings as settings_router,
    users,
)
from .seed import seed_if_empty


# create_all은 기존 테이블에 컬럼을 추가하지 않는다 — 스키마 변경은 여기에 idempotent DDL로 누적
MIGRATIONS = [
    "ALTER TABLE assessments ADD COLUMN IF NOT EXISTS ai_max_turns INTEGER NOT NULL DEFAULT 20",
    "ALTER TABLE attempt_problem_states ADD COLUMN IF NOT EXISTS code_by_lang JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE assessments ADD COLUMN IF NOT EXISTS ai_provider_id UUID REFERENCES ai_providers(id) ON DELETE SET NULL",
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # DB가 뜰 때까지 재시도 (compose 기동 레이스 대비)
    for i in range(30):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
                for stmt in MIGRATIONS:
                    await conn.execute(text(stmt))
            break
        except Exception:
            if i == 29:
                raise
            await asyncio.sleep(2)
    if settings.seed_demo_data:
        async with SessionLocal() as db:
            await seed_if_empty(db)
    async with SessionLocal() as db:
        await settings_router.migrate_legacy_ai_settings(db)
    yield
    await engine.dispose()


app = FastAPI(title="Harnesser API", version="0.5.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(problems.router)
app.include_router(assessments.router)
app.include_router(attempts.router)
app.include_router(executions.router)
app.include_router(ai.router)
app.include_router(review.router)
app.include_router(settings_router.router)
app.include_router(internal.router)


@app.get("/healthz")
async def healthz():
    return {"ok": True}
