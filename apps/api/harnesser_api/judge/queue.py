import json

import redis.asyncio as aioredis

from ..config import settings

QUEUE_KEY = "harnesser:judge:queue"

_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def enqueue_execution(
    execution_id: str,
    language: str,
    code: str,
    time_limit_ms: int,
    memory_limit_mb: int,
    tests: list[dict],
) -> None:
    job = {
        "execution_id": execution_id,
        "language": language,
        "code": code,
        "time_limit_ms": time_limit_ms,
        "memory_limit_mb": memory_limit_mb,
        "tests": tests,
    }
    await get_redis().lpush(QUEUE_KEY, json.dumps(job))
