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
from ..deps import Principal, get_principal
from ..ingest.gmail import GmailClient
from ..ingest.pipeline import ingest_account
from ..ingest.poll import poll_accounts
from ..models import Client, GmailAccount, Role
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


_CLIENT_ROLES = {
    Role.client_admin.value,
    Role.client_accountant.value,
    Role.client_user.value,
}


def _require_client_member(principal: Principal, client_id: UUID) -> bool:
    """メール連携は顧客側のメンバー(管理者/経理/一般社員)が行える。事務所職員/オーナーは不可。
    OAuth は「ボタンを押した本人のメールボックス」を連携するため、顧客本人が行う必要がある。
    一般社員は自分が連携したメールのみ、管理者(client_admin)は自顧問先の全メールを管理できる。
    管理者なら True を返す。"""
    is_member = False
    is_admin = False
    for m in principal.memberships:
        if m.client_id == client_id and m.role in _CLIENT_ROLES:
            is_member = True
            if m.role == Role.client_admin.value:
                is_admin = True
    if not is_member:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "メール連携はこの顧問先のメンバーのみ行えます"
        )
    return is_admin


def _require_account_manage(principal: Principal, account: GmailAccount) -> None:
    """連携済みメールの操作(取込/解除)。管理者は自顧問先の全件、一般社員は自分が連携した分のみ。"""
    is_admin = _require_client_member(principal, account.client_id)
    if not is_admin and account.connected_by != principal.user.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "自分が連携したメールのみ操作できます"
        )


def _client_relation(principal: Principal, client_id: UUID) -> str | None:
    """principal とこの顧問先の関係を返す: 'admin'(顧客管理者) / 'member'(経理・一般社員) /
    'firm'(事務所職員) / None(無関係)。取り込みボタンの対象アカウント範囲を決めるのに使う。"""
    for m in principal.memberships:
        if m.client_id == client_id:
            return "admin" if m.role == Role.client_admin.value else "member"
    # 事務所側(firm_owner/firm_staff)は client_id=None の事務所メンバーシップを持つ。
    # 実際にこの顧問先へアクセスできるかは RLS(app_client_access)が最終的に絞る。
    if any(m.client_id is None for m in principal.memberships):
        return "firm"
    return None


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
        # PKCE を無効化。connect と callback で別の Flow インスタンスを使うため
        # code_verifier を共有できない。confidential client (client_secret あり)なので
        # PKCE 無しで安全。両側で無効にすることで code_challenge/verifier の不一致を避ける。
        autogenerate_code_verifier=False,
    )


@router.get("/connect")
async def connect(
    client_id: UUID,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """顧問先に Gmail を連携開始。Google の同意画面へリダイレクトする。"""
    _require_client_member(principal, client_id)
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
    _require_client_member(principal, client_id)
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
    is_admin = _require_client_member(principal, client_id)
    stmt = select(GmailAccount).where(GmailAccount.client_id == client_id)
    if not is_admin:
        # 一般社員/経理担当者は自分が連携したメールのみ。
        stmt = stmt.where(GmailAccount.connected_by == principal.user.id)
    rows = await session.scalars(stmt.order_by(GmailAccount.created_at))
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
    _require_account_manage(principal, account)
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
    _require_account_manage(principal, account)
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


@router.post("/poll")
async def poll_now(
    client_id: UUID,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """受信箱の「メール取込」ボタン: この顧問先の連携メールを今すぐまとめて取り込む。
    定期実行(Cron相当のポーラ)と同じ poll_accounts を呼ぶ手動キック。
    顧客管理者/事務所職員は顧問先の全メール、経理・一般社員は自分が連携した分が対象。"""
    rel = _client_relation(principal, client_id)
    if rel is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "この顧問先のメールを取り込む権限がありません")
    stmt = select(GmailAccount).where(
        GmailAccount.client_id == client_id, GmailAccount.active.is_(True)
    )
    if rel == "member":
        # 経理・一般社員は自分が連携したメールだけ。管理者/事務所は全件(RLSがアクセスを最終確認)。
        stmt = stmt.where(GmailAccount.connected_by == principal.user.id)
    accounts = list(await session.scalars(stmt.order_by(GmailAccount.created_at)))
    if not accounts:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "連携中のメールがありません")
    stats = await poll_accounts(session, accounts, days=90)
    return stats
