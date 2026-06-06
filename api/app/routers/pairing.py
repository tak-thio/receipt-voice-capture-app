"""QR device pairing for mobile (client_user) onboarding.

Flow:
  1. A firm user POSTs /pairing/issue for a client -> one-time token + QR PNG.
  2. The mobile app scans the QR and POSTs /pairing/redeem {token}
     -> a long-lived device token (sent thereafter as `Authorization: Bearer`).
No password is typed on the phone.
"""

import base64
import io
import json
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import qrcode
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_session, set_rls_context
from ..deps import Principal, can_admin_client, get_principal
from ..models import Client, DeviceSession, Membership, PairingToken, Role, User
from ..security import hash_token, new_token

router = APIRouter(prefix="/pairing", tags=["pairing"])

settings = get_settings()
PAIRING_TTL_MIN = 15


class IssueBody(BaseModel):
    client_id: UUID
    user_id: UUID | None = None  # pair a specific named user (preferred)
    email: str | None = None
    name: str = "顧問先ユーザー"


class RedeemBody(BaseModel):
    token: str


@router.post("/issue")
async def issue(
    body: IssueBody,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    if not await can_admin_client(session, principal, body.client_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "cannot manage this client")
    # RLS ensures the actor can only target clients in their own firm.
    client = await session.get(Client, body.client_id)
    if not client:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client not found")

    if body.user_id:
        # Pair a specific, already-registered named user of this client.
        user = await session.get(User, body.user_id)
        membership = await session.scalar(
            select(Membership).where(
                Membership.user_id == body.user_id, Membership.client_id == client.id
            )
        )
        if not user or not membership:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "client user not found")
    else:
        # Fallback: find or create a user by email (anonymous device if omitted).
        email = body.email or f"device-{uuid4().hex[:12]}@devices.local"
        user = await session.scalar(select(User).where(User.email == email))
        if not user:
            user = User(email=email, name=body.name)
            session.add(user)
            await session.flush()
        membership = await session.scalar(
            select(Membership).where(
                Membership.user_id == user.id,
                Membership.firm_id == client.firm_id,
                Membership.client_id == client.id,
            )
        )
        if not membership:
            session.add(
                Membership(
                    user_id=user.id,
                    firm_id=client.firm_id,
                    client_id=client.id,
                    role=Role.client_user.value,
                )
            )

    token = new_token()
    session.add(
        PairingToken(
            firm_id=client.firm_id,
            client_id=client.id,
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=PAIRING_TTL_MIN),
        )
    )

    # 公開URLが設定されていれば {"url","t"} を QR に入れ、1スキャンで接続先+トークンを得る。
    # 未設定なら従来どおり bare token(端末側で URL を手入力)。
    if settings.public_api_url:
        qr_content = json.dumps(
            {"url": settings.public_api_url, "t": token}, separators=(",", ":")
        )
    else:
        qr_content = token
    img = qrcode.make(qr_content)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()
    return {
        "token": token,  # for testing; production shows only the QR
        "qr_png_base64": qr_b64,
        "url": settings.public_api_url or None,
        "expires_in_min": PAIRING_TTL_MIN,
        "client_id": str(client.id),
        "user_id": str(user.id),
    }


@router.post("/redeem")
async def redeem(body: RedeemBody, session: AsyncSession = Depends(get_session)):
    # No auth: the token IS the credential. Identity tables are not RLS-bound.
    pt = await session.scalar(
        select(PairingToken).where(PairingToken.token_hash == hash_token(body.token))
    )
    if not pt or pt.used_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid token")
    if pt.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "token expired")

    pt.used_at = datetime.now(timezone.utc)
    device_token = new_token()
    session.add(
        DeviceSession(
            user_id=pt.user_id,
            client_id=pt.client_id,
            refresh_token_hash=hash_token(device_token),
        )
    )
    return {
        "access_token": device_token,
        "client_id": str(pt.client_id),
        "user_id": str(pt.user_id),
    }
