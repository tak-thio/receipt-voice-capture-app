"""Gmail 連携 (OAuth) と取り込み。

顧客側のユーザー(client_admin 等)が「連携」ボタンで自分の Gmail を顧問先に紐付け、
そのメールに届く領収書を取り込む。OAuth は公開HTTPSドメイン(WAN)でのみ機能する。
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool
from starlette.responses import RedirectResponse

from ..config import get_settings
from ..db import get_session
from ..deps import Principal, can_admin_client, get_principal
from ..ingest.gmail import GmailClient
from ..ingest.pipeline import ingest_account
from ..models import Client, GmailAccount
from ..security import encrypt_secret, make_oauth_state, read_oauth_state

# Google が openid を自動付与してスコープ不一致になるのを避ける。
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

settings = get_settings()
router = APIRouter(prefix="/gmail", tags=["gmail"])

GMAIL_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.readonly",
]


def _flow():
    from google_auth_oauthlib.flow import Flow

    if not (settings.google_client_id and settings.google_client_secret and settings.gmail_oauth_redirect_uri):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Gmail OAuth is not configured on this server")
    return Flow.from_client_config(
        {
            "web": {
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=GMAIL_SCOPES,
        redirect_uri=settings.gmail_oauth_redirect_uri,
    )


@router.get("/connect")
async def connect(
    client_id: UUID,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """顧問先に Gmail を連携開始。Google の同意画面へリダイレクトする。"""
    if not await can_admin_client(session, principal, client_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "cannot manage this client")
    flow = _flow()
    state = make_oauth_state({"cid": str(client_id), "uid": str(principal.user.id)})
    auth_url, _ = flow.authorization_url(
        access_type="offline", prompt="consent", include_granted_scopes="true", state=state
    )
    return RedirectResponse(auth_url, status_code=302)


@router.get("/oauth/callback")
async def callback(
    state: str,
    code: str | None = None,
    error: str | None = None,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    data = read_oauth_state(state)
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid or expired oauth state")
    client_id = UUID(data["cid"])
    if not await can_admin_client(session, principal, client_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "cannot manage this client")
    if error or not code:
        return RedirectResponse("/?gmail=error", status_code=302)

    flow = _flow()
    await run_in_threadpool(lambda: flow.fetch_token(code=code))
    creds = flow.credentials
    email = await run_in_threadpool(GmailClient(creds).profile_email)
    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "could not read mailbox address")

    client = await session.get(Client, client_id)
    if not client:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client not found")

    account = await session.scalar(
        select(GmailAccount).where(
            GmailAccount.client_id == client_id, GmailAccount.email == email
        )
    )
    if account is None:
        account = GmailAccount(
            firm_id=client.firm_id, client_id=client_id, email=email,
            connected_by=principal.user.id, auth_type="oauth",
        )
        session.add(account)
    account.access_token_enc = encrypt_secret(creds.token)
    # Google は再同意時に refresh_token を省くことがある。来た時だけ更新。
    if creds.refresh_token:
        account.refresh_token_enc = encrypt_secret(creds.refresh_token)
    account.scopes = " ".join(creds.scopes or [])
    account.token_expires_at = creds.expiry.replace(tzinfo=timezone.utc) if creds.expiry else None
    account.active = True
    await session.flush()
    return RedirectResponse("/?gmail=linked", status_code=302)


def _account_dict(a: GmailAccount) -> dict:
    return {
        "id": str(a.id),
        "email": a.email,
        "active": a.active,
        "auth_type": a.auth_type,
        "scopes": a.scopes,
        "has_refresh_token": a.refresh_token_enc is not None,
        "last_synced_at": a.last_synced_at.isoformat() if a.last_synced_at else None,
        "connected_at": a.created_at.isoformat() if a.created_at else None,
    }


@router.get("/accounts")
async def list_accounts(
    client_id: UUID,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    if not await can_admin_client(session, principal, client_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "cannot manage this client")
    rows = await session.scalars(
        select(GmailAccount).where(GmailAccount.client_id == client_id).order_by(GmailAccount.created_at)
    )
    return [_account_dict(a) for a in rows]


@router.delete("/accounts/{account_id}")
async def disconnect(
    account_id: UUID,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    account = await session.get(GmailAccount, account_id)
    if not account:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    if not await can_admin_client(session, principal, account.client_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "cannot manage this client")
    await session.delete(account)
    return {"ok": True}


@router.post("/accounts/{account_id}/sync")
async def sync_account(
    account_id: UUID,
    days: int = 90,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """今すぐ取り込み。既定で直近90日を走査(重複はスキップ)。"""
    account = await session.get(GmailAccount, account_id)
    if not account:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    if not await can_admin_client(session, principal, account.client_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "cannot manage this client")
    now = datetime.now(timezone.utc)
    after = (now - timedelta(days=max(1, days))).strftime("%Y/%m/%d")
    before = (now + timedelta(days=1)).strftime("%Y/%m/%d")
    try:
        stats = await ingest_account(
            session, account, after=after, before=before, query=settings.gmail_query
        )
    except Exception as exc:  # noqa: BLE001 — surface a clean error to the UI
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Gmail 取り込みに失敗しました: {exc}")
    return stats
