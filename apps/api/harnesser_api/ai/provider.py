"""LLM 공급자 계층 — geny-executor의 통합 llm_client 위에 구축.

지원 백엔드: openai / anthropic / google / vllm / ollama / lmstudio / custom
(claude_code_cli는 서브프로세스 CLI 방식이라 서버 환경에 부적합해 제외).

geny-executor의 llm_client 서브패키지만 사용한다 — 에이전트 파이프라인과
내장 툴은 로드하지 않으며, 모든 호출은 tools=None(순수 채팅)이다.

해석 우선순위:
  채팅: 시험별 지정 공급자 → 기본 채팅 공급자 → 활성 공급자 중 첫 번째 → env 폴백
  평가: 기본 평가 공급자 → 채팅 해석 결과
"""

import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from geny_executor.core.config import ModelConfig
from geny_executor.llm_client import ClientRegistry, discover_models

from ..config import settings
from ..models import AiProvider

# ── 공급자 카탈로그 (설정 패널 메타) ─────────────────────────────

PROVIDER_CATALOG: list[dict] = [
    {
        "provider": "openai",
        "label": "OpenAI",
        "kind": "cloud",
        "needs_key": True,
        "needs_base_url": False,
        "default_base_url": None,
        "placeholder_model": "gpt-4o-mini",
        "description": "OpenAI API (gpt-4o, o3 등). base URL을 바꾸면 Azure/프록시도 사용 가능.",
    },
    {
        "provider": "anthropic",
        "label": "Anthropic Claude",
        "kind": "cloud",
        "needs_key": True,
        "needs_base_url": False,
        "default_base_url": None,
        "placeholder_model": "claude-sonnet-4-6",
        "description": "Anthropic Messages API (Claude 계열).",
    },
    {
        "provider": "google",
        "label": "Google Gemini",
        "kind": "cloud",
        "needs_key": True,
        "needs_base_url": False,
        "default_base_url": None,
        "placeholder_model": "gemini-2.0-flash",
        "description": "Google Gemini API.",
    },
    {
        "provider": "vllm",
        "label": "vLLM",
        "kind": "local",
        "needs_key": False,
        "needs_base_url": True,
        "default_base_url": "http://localhost:8000/v1",
        "placeholder_model": "(서빙 중인 모델 ID)",
        "description": "vLLM OpenAI 호환 서버. base URL 필수.",
    },
    {
        "provider": "ollama",
        "label": "Ollama",
        "kind": "local",
        "needs_key": False,
        "needs_base_url": False,
        "default_base_url": "http://localhost:11434/v1",
        "placeholder_model": "qwen2.5-coder:14b",
        "description": "Ollama 로컬 서버 (/v1 OpenAI 호환 엔드포인트).",
    },
    {
        "provider": "lmstudio",
        "label": "LM Studio",
        "kind": "local",
        "needs_key": False,
        "needs_base_url": False,
        "default_base_url": "http://127.0.0.1:1234/v1",
        "placeholder_model": "(로드된 모델 ID)",
        "description": "LM Studio 로컬 서버.",
    },
    {
        "provider": "custom",
        "label": "OpenAI 호환 (커스텀)",
        "kind": "local",
        "needs_key": False,
        "needs_base_url": True,
        "default_base_url": None,
        "placeholder_model": "(엔드포인트의 모델 ID)",
        "description": "llama.cpp server, LiteLLM, 사내 게이트웨이 등 모든 OpenAI 호환 엔드포인트.",
    },
]

VALID_PROVIDERS = {c["provider"] for c in PROVIDER_CATALOG}


def catalog_entry(provider: str) -> dict | None:
    return next((c for c in PROVIDER_CATALOG if c["provider"] == provider), None)


# ── 해석된 실행 설정 ─────────────────────────────────────────────


@dataclass
class ResolvedAi:
    provider: str
    model: str
    api_key: str = ""
    base_url: str | None = None
    temperature: float = 0.2
    max_tokens: int = 4096
    default_headers: dict = field(default_factory=dict)
    name: str = ""  # 공급자 표시 이름
    source: str = "db"  # db | env
    provider_row_id: str | None = None

    @property
    def configured(self) -> bool:
        entry = catalog_entry(self.provider)
        if entry and entry["needs_key"] and not self.api_key:
            return False
        if entry and entry["needs_base_url"] and not self.base_url:
            return False
        return bool(self.model)


def resolved_from_row(row: AiProvider) -> ResolvedAi:
    return ResolvedAi(
        provider=row.provider,
        model=row.model,
        api_key=row.api_key or "",
        base_url=row.base_url or None,
        temperature=row.temperature,
        max_tokens=row.max_tokens,
        default_headers=dict(row.default_headers or {}),
        name=row.name,
        source="db",
        provider_row_id=str(row.id),
    )


def _env_fallback() -> ResolvedAi | None:
    """DB에 공급자가 없을 때 .env(AI_*)로 동작하는 폴백."""
    if not settings.ai_api_key:
        return None
    base = (settings.ai_base_url or "").rstrip("/")
    provider = "openai" if "api.openai.com" in base else "custom"
    return ResolvedAi(
        provider=provider,
        model=settings.ai_chat_model,
        api_key=settings.ai_api_key,
        base_url=base or None,
        name="환경변수(.env)",
        source="env",
    )


async def resolve_ai(
    db: AsyncSession,
    purpose: str = "chat",
    override_provider_id: uuid.UUID | None = None,
) -> ResolvedAi | None:
    """실행할 공급자를 해석. 없으면 None (=미설정)."""
    if override_provider_id:
        row = await db.get(AiProvider, override_provider_id)
        if row and row.enabled:
            return resolved_from_row(row)

    rows = (
        await db.execute(
            select(AiProvider).where(AiProvider.enabled.is_(True)).order_by(AiProvider.created_at)
        )
    ).scalars().all()
    if rows:
        if purpose == "eval":
            for r in rows:
                if r.is_eval_default:
                    return resolved_from_row(r)
        for r in rows:
            if r.is_chat_default:
                return resolved_from_row(r)
        return resolved_from_row(rows[0])
    return _env_fallback()


# ── geny-executor 클라이언트 구성/호출 ───────────────────────────


def build_client(res: ResolvedAi):
    """ResolvedAi → geny-executor BaseClient. 툴/에이전트 기능은 사용하지 않는다."""
    cls = ClientRegistry.get(res.provider)
    kwargs: dict[str, Any] = {"api_key": res.api_key or "EMPTY"}
    if res.base_url:
        kwargs["base_url"] = res.base_url
    if res.default_headers:
        kwargs["default_headers"] = res.default_headers
    return cls(**kwargs)


def _model_config(res: ResolvedAi, max_tokens: int | None = None) -> ModelConfig:
    return ModelConfig(
        model=res.model,
        max_tokens=max_tokens or res.max_tokens,
        temperature=res.temperature,
    )


def _clean_messages(messages: list[dict]) -> list[dict]:
    """빈 내용 메시지 제거(일부 벤더는 빈 content를 거부) + 역할 정규화."""
    out = []
    for m in messages:
        content = str(m.get("content", "") or "").strip()
        role = m.get("role", "user")
        if not content or role not in ("user", "assistant"):
            continue
        out.append({"role": role, "content": content})
    # 대화는 user로 시작해야 하는 벤더(anthropic) 대응
    while out and out[0]["role"] != "user":
        out.pop(0)
    return out


async def stream_text(
    res: ResolvedAi, messages: list[dict], system: str = ""
) -> AsyncIterator[str]:
    """텍스트 델타 스트림. 스트리밍 미지원 백엔드는 완성문을 한 번에 낸다."""
    client = build_client(res)
    got_delta = False
    async for event in client.create_message_stream(
        model_config=_model_config(res),
        messages=_clean_messages(messages),
        system=system,
        tools=None,
        purpose="harnesser.chat",
    ):
        etype = event.get("type")
        if etype == "text_delta" and event.get("text"):
            got_delta = True
            yield event["text"]
        elif etype == "message_complete" and not got_delta:
            response = event.get("response")
            text = getattr(response, "text", "") if response else ""
            if text:
                yield text


async def complete_text(
    res: ResolvedAi, messages: list[dict], system: str = "", max_tokens: int | None = None
) -> str:
    """비스트리밍 완성 (자동평가/연결 테스트용)."""
    client = build_client(res)
    response = await client.create_message(
        model_config=_model_config(res, max_tokens=max_tokens),
        messages=_clean_messages(messages),
        system=system,
        tools=None,
        purpose="harnesser.complete",
    )
    return response.text


async def list_models(res: ResolvedAi) -> dict:
    """라이브 모델 디스커버리 (설정 패널의 모델 선택기)."""
    result = await discover_models(res.provider, api_key=res.api_key or None, base_url=res.base_url)
    return {
        "source": result.source,
        "error": result.error,
        "models": [
            {"id": m.id, "display_name": m.display_name}
            for m in result.models
        ],
    }
