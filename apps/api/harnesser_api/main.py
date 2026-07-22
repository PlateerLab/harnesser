import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import Base, SessionLocal, engine
from .routers import ai, assessments, attempts, auth, executions, internal, problems, review, users
from .seed import seed_if_empty


@asynccontextmanager
async def lifespan(app: FastAPI):
    # DB가 뜰 때까지 재시도 (compose 기동 레이스 대비)
    for i in range(30):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            break
        except Exception:
            if i == 29:
                raise
            await asyncio.sleep(2)
    if settings.seed_demo_data:
        async with SessionLocal() as db:
            await seed_if_empty(db)
    yield
    await engine.dispose()


app = FastAPI(title="Harnesser API", version="0.1.0", lifespan=lifespan)

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
app.include_router(internal.router)


@app.get("/healthz")
async def healthz():
    return {"ok": True}
