"""連携済み Gmail をまとめて取り込む共通ルーチン。

定期実行(worker のポーラ=Cron相当)と、受信箱の「メール取込」ボタン(手動キック)が
同じこの関数を呼ぶ。1アカウントが失敗しても他は続行する。重複(同 account+msg_id)は
ingest_account 側でスキップされる。
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..models import GmailAccount
from .pipeline import ingest_account

settings = get_settings()
log = logging.getLogger(__name__)


async def poll_accounts(
    session: AsyncSession, accounts: list[GmailAccount], *, days: int = 90
) -> dict:
    """各アカウントを順に取り込み、合算した統計 {accounts, seen, appended, failed} を返す。"""
    now = datetime.now(timezone.utc)
    after = (now - timedelta(days=max(1, days))).strftime("%Y/%m/%d")
    before = (now + timedelta(days=1)).strftime("%Y/%m/%d")
    out = {"accounts": 0, "seen": 0, "appended": 0, "failed": 0}
    for acc in accounts:
        if not acc.active:
            continue
        out["accounts"] += 1
        try:
            stats = await ingest_account(
                session, acc, after=after, before=before, query=settings.gmail_query
            )
            out["seen"] += stats.get("seen", 0)
            out["appended"] += stats.get("appended", 0)
        except Exception:  # noqa: BLE001 — このアカウントは飛ばして続行(全滅を防ぐ)
            log.exception("gmail poll failed account=%s client=%s", acc.id, acc.client_id)
            out["failed"] += 1
    return out
