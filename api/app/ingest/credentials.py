"""Build/refresh Google OAuth credentials from a stored gmail_accounts row.

トークンは security.encrypt_secret / decrypt_secret(Fernet)で暗号化保存。
access_token が失効していれば refresh_token で更新し、回転後の値を保存する。
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from ..config import get_settings
from ..models import GmailAccount
from ..security import decrypt_secret, encrypt_secret

settings = get_settings()
log = logging.getLogger(__name__)


def credentials_from_account(account: GmailAccount) -> Credentials:
    return Credentials(
        token=decrypt_secret(account.access_token_enc) if account.access_token_enc else None,
        refresh_token=decrypt_secret(account.refresh_token_enc) if account.refresh_token_enc else None,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        scopes=account.scopes.split() if account.scopes else None,
    )


async def refresh_and_persist(account: GmailAccount, session: AsyncSession) -> Credentials:
    """Return ready-to-use credentials, refreshing + persisting the access token
    if it has expired."""
    creds = credentials_from_account(account)
    if not creds.valid and creds.refresh_token:
        await run_in_threadpool(creds.refresh, Request())
        account.access_token_enc = encrypt_secret(creds.token)
        if creds.refresh_token:
            account.refresh_token_enc = encrypt_secret(creds.refresh_token)
        if creds.expiry:
            # google-auth stores expiry as naive UTC; tag it for Postgres.
            account.token_expires_at = creds.expiry.replace(tzinfo=timezone.utc)
        await session.flush()
        log.info("refreshed access_token for gmail_account id=%s", account.id)
    account.last_synced_at = datetime.now(timezone.utc)
    return creds
