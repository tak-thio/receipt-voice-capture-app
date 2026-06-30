"""Firm settings and per-firm AI configuration (provider + encrypted keys)."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import Principal, firm_id_of, get_principal, require_firm_role
from ..models import Firm
from ..security import encrypt_secret

router = APIRouter(prefix="/firm", tags=["firm"])

SELF_HOSTED = {"ollama", "whisper", "mock"}


class FirmPatch(BaseModel):
    name: str


class CapabilityConfig(BaseModel):
    provider: str
    key: str | None = None  # plaintext; encrypted server-side. Omit to keep existing.
    model: str | None = None


class AiConfigIn(BaseModel):
    stt: CapabilityConfig | None = None
    ocr: CapabilityConfig | None = None
    format: CapabilityConfig | None = None


def _mask(ai_config: dict) -> dict:
    return {
        cap: {
            "provider": v.get("provider"),
            "model": v.get("model"),
            "key_set": bool(v.get("key_enc")),
        }
        for cap, v in (ai_config or {}).items()
    }


@router.get("")
async def get_firm(
    principal: Principal = Depends(require_firm_role("firm_owner")),
    session: AsyncSession = Depends(get_session),
):
    firm = await session.get(Firm, firm_id_of(principal))
    if not firm:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "firm not found")
    return {
        "id": str(firm.id),
        "name": firm.name,
        "plan": firm.plan,
        "ai_config": _mask(firm.ai_config),
    }


@router.patch("")
async def patch_firm(
    body: FirmPatch,
    principal: Principal = Depends(require_firm_role("firm_owner")),
    session: AsyncSession = Depends(get_session),
):
    firm = await session.get(Firm, firm_id_of(principal))
    if not firm:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "firm not found")
    firm.name = body.name
    return {"ok": True}


@router.patch("/ai-config")
async def patch_ai_config(
    body: AiConfigIn,
    principal: Principal = Depends(require_firm_role("firm_owner")),
    session: AsyncSession = Depends(get_session),
):
    firm = await session.get(Firm, firm_id_of(principal))
    if not firm:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "firm not found")

    config = dict(firm.ai_config or {})
    for cap in ("stt", "ocr", "format"):
        cfg: CapabilityConfig | None = getattr(body, cap)
        if cfg is None:
            continue
        entry: dict = {"provider": cfg.provider}
        if cfg.model:
            entry["model"] = cfg.model
        if cfg.provider in SELF_HOSTED:
            pass  # no key needed
        elif cfg.key:
            entry["key_enc"] = encrypt_secret(cfg.key)
        elif config.get(cap, {}).get("key_enc"):
            entry["key_enc"] = config[cap]["key_enc"]  # keep existing key
        else:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"{cap}: provider {cfg.provider} requires a key"
            )
        config[cap] = entry

    firm.ai_config = config  # reassign so SQLAlchemy detects the JSONB change
    return {"ai_config": _mask(config)}
