"""OpenAI 호환 Chat Completions 클라이언트 (OpenAI / Anthropic compat / vLLM / 사내 게이트웨이)."""

import json
from typing import AsyncIterator

import httpx

from ..config import settings


def is_configured() -> bool:
    return bool(settings.ai_api_key)


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.ai_api_key}",
        "Content-Type": "application/json",
    }


async def stream_chat(messages: list[dict], model: str | None = None) -> AsyncIterator[str]:
    """토큰 델타를 순서대로 yield. 오류 시 RuntimeError."""
    url = settings.ai_base_url.rstrip("/") + "/chat/completions"
    payload = {"model": model or settings.ai_chat_model, "messages": messages, "stream": True}
    async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=15)) as client:
        async with client.stream("POST", url, headers=_headers(), json=payload) as resp:
            if resp.status_code != 200:
                body = (await resp.aread()).decode(errors="replace")[:500]
                raise RuntimeError(f"AI 응답 오류 (HTTP {resp.status_code}): {body}")
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    chunk = json.loads(data)
                    delta = chunk["choices"][0]["delta"].get("content")
                    if delta:
                        yield delta
                except (json.JSONDecodeError, LookupError):
                    continue


async def complete_chat(messages: list[dict], model: str | None = None, max_tokens: int = 4096) -> str:
    """비스트리밍 완성 (자동평가용)."""
    url = settings.ai_base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": model or settings.ai_eval_model,
        "messages": messages,
        "max_tokens": max_tokens,
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=15)) as client:
        resp = await client.post(url, headers=_headers(), json=payload)
        if resp.status_code != 200:
            raise RuntimeError(f"AI 응답 오류 (HTTP {resp.status_code}): {resp.text[:500]}")
        return resp.json()["choices"][0]["message"]["content"] or ""
