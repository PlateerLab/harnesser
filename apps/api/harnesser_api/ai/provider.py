"""OpenAI 호환 Chat Completions 클라이언트 (OpenAI / Anthropic compat / vLLM / 사내 게이트웨이).

설정 우선순위: DB(app_settings key='ai', 관리자 UI에서 편집) → 환경변수.
"""

import json
from dataclasses import dataclass
from typing import AsyncIterator

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import AppSetting


@dataclass
class AiConfig:
    base_url: str
    api_key: str
    chat_model: str
    eval_model: str

    @property
    def configured(self) -> bool:
        return bool(self.api_key)


async def get_ai_config(db: AsyncSession) -> AiConfig:
    row = await db.get(AppSetting, "ai")
    v = (row.value or {}) if row else {}
    return AiConfig(
        base_url=(v.get("base_url") or settings.ai_base_url).rstrip("/"),
        api_key=v.get("api_key") or settings.ai_api_key,
        chat_model=v.get("chat_model") or settings.ai_chat_model,
        eval_model=v.get("eval_model") or v.get("chat_model") or settings.ai_eval_model,
    )


def _headers(cfg: AiConfig) -> dict:
    return {
        "Authorization": f"Bearer {cfg.api_key}",
        "Content-Type": "application/json",
    }


async def stream_chat(cfg: AiConfig, messages: list[dict]) -> AsyncIterator[str]:
    """토큰 델타를 순서대로 yield. 오류 시 RuntimeError."""
    url = cfg.base_url + "/chat/completions"
    payload = {"model": cfg.chat_model, "messages": messages, "stream": True}
    async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=15)) as client:
        async with client.stream("POST", url, headers=_headers(cfg), json=payload) as resp:
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


async def complete_chat(
    cfg: AiConfig, messages: list[dict], use_eval_model: bool = False, max_tokens: int = 4096
) -> str:
    """비스트리밍 완성 (자동평가/연결 테스트용)."""
    url = cfg.base_url + "/chat/completions"
    payload = {
        "model": cfg.eval_model if use_eval_model else cfg.chat_model,
        "messages": messages,
        "max_tokens": max_tokens,
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=15)) as client:
        resp = await client.post(url, headers=_headers(cfg), json=payload)
        if resp.status_code != 200:
            raise RuntimeError(f"AI 응답 오류 (HTTP {resp.status_code}): {resp.text[:500]}")
        return resp.json()["choices"][0]["message"]["content"] or ""
