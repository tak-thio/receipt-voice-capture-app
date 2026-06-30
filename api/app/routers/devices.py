"""モバイル端末の FCM 登録トークン。端末が起動時にトークンを登録/更新する。"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import Principal, get_principal
from ..models import DeviceToken

router = APIRouter(prefix="/devices", tags=["devices"])


class FcmTokenIn(BaseModel):
    token: str
    platform: str = "android"


@router.post("/fcm-token", status_code=status.HTTP_204_NO_CONTENT)
async def register_fcm_token(
    body: FcmTokenIn,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """FCMトークンを端末の利用者(principal)に紐づけて保存。再登録は last_seen を更新。"""
    token = (body.token or "").strip()
    if not token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "token required")
    client_id = principal.device_client_id or next(
        (m.client_id for m in principal.memberships if m.client_id is not None), None
    )
    firm_id = principal.memberships[0].firm_id if principal.memberships else None
    now = datetime.now(timezone.utc)
    existing = await session.scalar(select(DeviceToken).where(DeviceToken.token == token))
    if existing:
        existing.user_id = principal.user.id
        existing.client_id = client_id
        existing.platform = body.platform or "android"
        existing.last_seen_at = now
    else:
        session.add(
            DeviceToken(
                firm_id=firm_id,
                client_id=client_id,
                user_id=principal.user.id,
                token=token,
                platform=body.platform or "android",
                last_seen_at=now,
            )
        )
    await session.flush()
