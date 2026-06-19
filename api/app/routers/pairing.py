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
from ..models import Client, DeviceSession, Firm, Membership, PairingToken, Role, User
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


def _qr_png_b64(token: str) -> str:
    """ペアリングQRの内容(公開URLがあれば {url,t}、無ければ生token)を PNG base64 に。"""
    if settings.public_api_url:
        qr_content = json.dumps({"url": settings.public_api_url, "t": token}, separators=(",", ":"))
    else:
        qr_content = token
    img = qrcode.make(qr_content)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


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

    qr_b64 = _qr_png_b64(token)
    return {
        "token": token,  # for testing; production shows only the QR
        "qr_png_base64": qr_b64,
        "url": settings.public_api_url or None,
        "expires_in_min": PAIRING_TTL_MIN,
        "client_id": str(client.id),
        "user_id": str(user.id),
    }


@router.post("/self")
async def issue_self(
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """ログイン中の本人が、自分のアカウントに端末を紐付けるための QR を発行する。
    管理者が代理発行する /issue と違い、対象は常に呼び出し本人＝権限昇格にならない。
    顧問先メンバー(client_user/accountant/admin)向け。事務所メンバーは対象外。"""
    membership = next((m for m in principal.memberships if m.client_id is not None), None)
    if not membership:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "顧問先に所属していないため連携できません")
    client = await session.get(Client, membership.client_id)
    if not client:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client not found")

    token = new_token()
    session.add(
        PairingToken(
            firm_id=client.firm_id,
            client_id=client.id,
            user_id=principal.user.id,
            token_hash=hash_token(token),
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=PAIRING_TTL_MIN),
        )
    )
    return {
        "qr_png_base64": _qr_png_b64(token),
        "url": settings.public_api_url or None,
        "expires_in_min": PAIRING_TTL_MIN,
        "client_id": str(client.id),
        "user_id": str(principal.user.id),
    }


@router.post("/demo")
async def demo(session: AsyncSession = Depends(get_session)):
    """ログイン不要のデモ接続(ストア審査/お試し用)。デモ用顧問先(サンドボックス)の一般社員として
    端末トークンを発行する。設定 demo_client_id が空ならデモ無効(404)。redeem と同じ形を返す。"""
    if not settings.demo_client_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "demo not available")
    try:
        demo_cid = UUID(settings.demo_client_id)
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "demo not available")
    # デモ顧問先の一般社員(client_user)を使う(未認証=app_uid NULL なので memberships は NULL 逃しで読める)。
    membership = await session.scalar(
        select(Membership).where(
            Membership.client_id == demo_cid,
            Membership.role == Role.client_user.value,
        )
    )
    if not membership:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "demo not configured")

    device_token = new_token()
    session.add(
        DeviceSession(
            user_id=membership.user_id,
            client_id=membership.client_id,
            refresh_token_hash=hash_token(device_token),
        )
    )
    await session.flush()
    await set_rls_context(session, membership.user_id)
    user = await session.get(User, membership.user_id)
    client = await session.get(Client, demo_cid)
    firm = await session.get(Firm, membership.firm_id)
    return {
        "access_token": device_token,
        "client_id": str(demo_cid),
        "user_id": str(membership.user_id),
        "user_name": user.name if user else "デモ利用者",
        "job_title": "",
        "role": membership.role,
        "client_name": client.name if client else "デモ",
        "firm_name": firm.name if firm else "",
        "demo": True,
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
    await session.flush()  # 無コンテキストで確定(identity/device は RLS非依存)。

    # 端末の接続確認表示用に、サーバ権威の識別名を返す(QR には載せない情報)。
    # client/firm はテナントRLS対象。紐付け先ユーザーのRLSコンテキストを張ってから
    # 取得する(張らないと client_name / firm_name が空になる)。
    await set_rls_context(session, pt.user_id)
    user = await session.get(User, pt.user_id)
    client = await session.get(Client, pt.client_id)
    firm = await session.get(Firm, pt.firm_id)
    membership = await session.scalar(
        select(Membership).where(
            Membership.user_id == pt.user_id, Membership.client_id == pt.client_id
        )
    )
    return {
        "access_token": device_token,
        "client_id": str(pt.client_id),
        "user_id": str(pt.user_id),
        "user_name": user.name if user else "",
        "job_title": (user.job_title if user else None) or "",
        "role": membership.role if membership else "",
        "client_name": client.name if client else "",
        "firm_name": firm.name if firm else "",
    }
