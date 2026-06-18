"""Gmail 取り込みパイプライン: 1アカウント分のメールを Receipt 化する。

各メール = 1 領収書。添付(PDF/画像)があれば添付を保存して OCR ジョブ、
無ければ本文テキストを receipt.ocr_raw に入れて format ジョブを積む。OCR/整形は
既存ワーカーが処理し、摘要(AI)・取引先の完全一致引当まで行う。
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from .. import storage
from ..models import UNPARSED_VENDOR, File, GmailAccount, GmailMessage, Job, Receipt, ReceiptFile
from .credentials import refresh_and_persist
from .gmail import GmailClient, GmailMsg

_TAG_RE = re.compile(r"<[^>]+>")
# 無駄に大きい添付をAIに送らない上限（captures と揃える）。超えたら本文テキストにフォールバック。
_MAX_ATTACH_BYTES = 10 * 1024 * 1024


def _html_to_text(html: str) -> str:
    return re.sub(r"\s+\n", "\n", _TAG_RE.sub(" ", html or "")).strip()


async def _store_bytes(session: AsyncSession, account: GmailAccount, data: bytes, mime: str, kind: str) -> File:
    sha = hashlib.sha256(data).hexdigest()
    path = f"{account.firm_id}/{account.client_id}/{sha}"
    await run_in_threadpool(storage.put, path, data, mime or "application/octet-stream")
    f = File(
        firm_id=account.firm_id, client_id=account.client_id, sha256=sha, kind=kind,
        path=path, size=len(data), mime=mime or "", uploaded_by=account.connected_by,
    )
    session.add(f)
    await session.flush()
    return f


async def _message_to_receipt(session: AsyncSession, account: GmailAccount, msg: GmailMsg) -> Receipt:
    captured_at = (
        datetime.fromtimestamp(msg.internal_date_ms / 1000, tz=timezone.utc)
        if msg.internal_date_ms else datetime.now(timezone.utc)
    )
    receipt = Receipt(
        firm_id=account.firm_id,
        client_id=account.client_id,
        source="email",
        captured_at=captured_at,
        vendor=UNPARSED_VENDOR,
        created_by=account.connected_by,
        # 「メール本文を印刷したような画面」表示用に、件名/差出人/本文も保存する。
        capture_meta={
            "gmail_subject": msg.subject,
            "gmail_from": msg.from_addr,
            "gmail_account": account.email,
            "gmail_date": captured_at.isoformat(),
            "gmail_body_html": (msg.body_html or "")[:300000],
            "gmail_body_text": (msg.body_text or "")[:100000],
        },
    )
    session.add(receipt)
    await session.flush()

    if msg.attachments and len(msg.attachments[0].data) <= _MAX_ATTACH_BYTES:
        # 添付(PDF/画像) = 領収書本体。最初の添付を OCR にかける。
        a = msg.attachments[0]
        is_pdf = a.mime_type == "application/pdf" or a.filename.lower().endswith(".pdf")
        f = await _store_bytes(session, account, a.data, a.mime_type, "pdf" if is_pdf else "image")
        session.add(ReceiptFile(receipt_id=receipt.id, file_id=f.id, kind="capture"))
        session.add(Job(firm_id=account.firm_id, client_id=account.client_id, kind="ocr",
                        params={"receipt_id": str(receipt.id), "file_id": str(f.id)}))
    else:
        # 添付なし = 本文テキストから抽出(整形ジョブ)。
        body = (msg.body_text or "").strip() or _html_to_text(msg.body_html)
        receipt.ocr_raw = f"件名: {msg.subject}\n差出人: {msg.from_addr}\n\n{body}"[:20000]
        session.add(Job(firm_id=account.firm_id, client_id=account.client_id, kind="format",
                        params={"receipt_id": str(receipt.id)}))
    return receipt


async def ingest_account(
    session: AsyncSession, account: GmailAccount, *, after: str, before: str, query: str
) -> dict:
    """1アカウント分を取り込む。完全一致の重複(同 account+msg_id)はスキップ。"""
    creds = await refresh_and_persist(account, session)
    client = GmailClient(creds)
    msg_ids = await run_in_threadpool(
        client.search_message_ids, after=after, before=before, query=query
    )
    seen = appended = 0
    for mid in msg_ids:
        seen += 1
        dup = await session.scalar(
            select(GmailMessage.id).where(
                GmailMessage.account_id == account.id, GmailMessage.msg_id == mid
            )
        )
        if dup is not None:
            continue
        msg = await run_in_threadpool(client.fetch_message, mid)
        receipt = await _message_to_receipt(session, account, msg)
        internal_dt = (
            datetime.fromtimestamp(msg.internal_date_ms / 1000, tz=timezone.utc)
            if msg.internal_date_ms else None
        )
        session.add(GmailMessage(
            client_id=account.client_id, account_id=account.id, msg_id=mid,
            message_id=msg.message_id or None, receipt_id=receipt.id, internal_date=internal_dt,
        ))
        appended += 1
    account.last_synced_at = datetime.now(timezone.utc)
    await session.flush()
    return {"seen": seen, "appended": appended}
