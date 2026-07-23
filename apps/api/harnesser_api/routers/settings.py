import time

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai import provider
from ..ai.provider import AiConfig
from ..config import settings as env
from ..db import get_db
from ..deps import require_admin
from ..models import AppSetting
from ..schemas import AiSettingsIn

router = APIRouter(prefix="/admin/settings", tags=["settings"])


def _key_hint(key: str) -> str:
    return f"…{key[-4:]}" if len(key) >= 8 else "설정됨"


async def _get_row(db: AsyncSession) -> dict:
    row = await db.get(AppSetting, "ai")
    return dict(row.value or {}) if row else {}


async def _ai_out(db: AsyncSession) -> dict:
    v = await _get_row(db)
    cfg = await provider.get_ai_config(db)
    return {
        "base_url": v.get("base_url") or "",
        "chat_model": v.get("chat_model") or "",
        "eval_model": v.get("eval_model") or "",
        "has_key": bool(v.get("api_key")),
        "key_hint": _key_hint(v["api_key"]) if v.get("api_key") else None,
        "effective": {
            "configured": cfg.configured,
            "base_url": cfg.base_url,
            "chat_model": cfg.chat_model,
            "eval_model": cfg.eval_model,
            "source": "db" if v.get("api_key") else ("env" if env.ai_api_key else "none"),
        },
    }


@router.get("/ai", dependencies=[Depends(require_admin)])
async def get_ai_settings(db: AsyncSession = Depends(get_db)):
    return await _ai_out(db)


@router.put("/ai", dependencies=[Depends(require_admin)])
async def put_ai_settings(body: AiSettingsIn, db: AsyncSession = Depends(get_db)):
    row = await db.get(AppSetting, "ai")
    if not row:
        row = AppSetting(key="ai", value={})
        db.add(row)
    v = dict(row.value or {})
    v["base_url"] = body.base_url.strip()
    v["chat_model"] = body.chat_model.strip()
    v["eval_model"] = body.eval_model.strip()
    if body.api_key is not None:  # None이면 기존 키 유지, ""이면 삭제
        v["api_key"] = body.api_key.strip()
    row.value = v
    await db.commit()
    return await _ai_out(db)


@router.post("/ai/test", dependencies=[Depends(require_admin)])
async def test_ai_settings(body: AiSettingsIn, db: AsyncSession = Depends(get_db)):
    """저장 전에도 검증 가능한 라이브 연결 테스트 (api_key 미입력 시 저장된/env 키 사용)."""
    saved = await _get_row(db)
    effective = await provider.get_ai_config(db)
    cfg = AiConfig(
        base_url=(body.base_url.strip() or saved.get("base_url") or env.ai_base_url).rstrip("/"),
        api_key=(body.api_key or "").strip() or saved.get("api_key") or env.ai_api_key,
        chat_model=body.chat_model.strip() or effective.chat_model,
        eval_model=body.eval_model.strip() or effective.eval_model,
    )
    if not cfg.configured:
        return {"ok": False, "error": "API 키가 없습니다"}
    started = time.monotonic()
    try:
        reply = await provider.complete_chat(
            cfg,
            [{"role": "user", "content": "연결 확인입니다. '정상'이라고만 답하세요."}],
            max_tokens=16,
        )
    except Exception as e:  # noqa: BLE001 — 실패 사유를 그대로 관리자에게 보여준다
        return {"ok": False, "error": str(e)[:600]}
    return {
        "ok": True,
        "latency_ms": int((time.monotonic() - started) * 1000),
        "model": cfg.chat_model,
        "reply": reply[:200],
    }
