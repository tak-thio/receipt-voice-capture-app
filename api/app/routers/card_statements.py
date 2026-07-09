"""クレジットカード明細: 専用取込と「領収書の網羅チェック」。

- 取込: 画像/PDF を受け、AI 抽出した全行を doc_type=card_statement に固定(force_doc_type)。
  受信箱・仕分け・元帳には出さない(doc_type で除外)。明細は仕訳の元ではなく照合表。
- チェック: 各明細行に「同額 ＋ 日付±3日」の領収書があるかを ✓/✗ で返す。
"""
from __future__ import annotations

import hashlib
from collections import defaultdict
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status
from fastapi import File as FormFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from .. import storage
from ..db import get_session
from ..deps import Principal, get_principal
from ..journaling import normalize_vendor
from ..models import (
    UNPARSED_VENDOR,
    ApprovalStatus,
    Client,
    File,
    Job,
    Receipt,
    ReceiptFile,
    ReceiptLane,
    ReceiptSource,
)

router = APIRouter(prefix="/card-statements", tags=["card-statements"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 1ファイル 10MB
_MATCH_DAYS = 3  # 領収書との照合: 同額 ＋ 取引日 ±3日(利用日と領収書日付のズレを許容)


async def _images(session: AsyncSession, receipt_ids) -> dict:
    ids = list(receipt_ids)
    if not ids:
        return {}
    rows = await session.execute(
        select(ReceiptFile.receipt_id, ReceiptFile.file_id, File.mime)
        .join(File, File.id == ReceiptFile.file_id)
        .where(ReceiptFile.receipt_id.in_(ids), ReceiptFile.kind == "capture")
    )
    out: dict = {}
    for rid, fid, mime in rows.all():
        out.setdefault(rid, (fid, mime))
    return out


@router.post("/import", status_code=status.HTTP_201_CREATED)
async def import_statement(
    client_id: str = Form(...),
    file: UploadFile = FormFile(...),
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """クレジット明細(画像/PDF)を取り込む。全行 card_statement に固定。受信箱/仕分けには出さない。"""
    client = await session.get(Client, UUID(client_id))  # RLS-scoped
    if not client:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no access to this client")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "ファイルが大きすぎます（10MBまで）")
    sha = hashlib.sha256(data).hexdigest()
    path = f"{client.firm_id}/{client.id}/{sha}"
    await run_in_threadpool(storage.put, path, data, file.content_type or "application/octet-stream")
    kind = "pdf" if (file.content_type or "").endswith("pdf") else "image"
    f = File(
        firm_id=client.firm_id, client_id=client.id, sha256=sha, kind=kind, path=path,
        size=len(data), mime=file.content_type or "", filename=file.filename, uploaded_by=principal.user.id,
    )
    session.add(f)
    await session.flush()
    # プレースホルダは最初から card_statement / company で作る(受信箱に一瞬も出さない)。
    receipt = Receipt(
        firm_id=client.firm_id, client_id=client.id,
        source=ReceiptSource.card.value, lane=ReceiptLane.company.value,
        doc_type="card_statement", vendor=UNPARSED_VENDOR,
        captured_at=datetime.now(timezone.utc), created_by=principal.user.id,
    )
    session.add(receipt)
    await session.flush()
    session.add(ReceiptFile(receipt_id=receipt.id, file_id=f.id, kind="capture"))
    session.add(Job(
        firm_id=client.firm_id, client_id=client.id, kind="ocr",
        params={"receipt_id": str(receipt.id), "file_id": str(f.id), "force_doc_type": "card_statement"},
    ))
    return {"status": "queued"}


@router.get("")
async def list_statements(
    client_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """明細の各行 + 「紐づく領収書があるか」。照合キー = 同額 ＋ 取引日 ±3日。"""
    cards = list(await session.scalars(
        select(Receipt).where(
            Receipt.client_id == client_id,
            Receipt.doc_type == "card_statement",
            Receipt.approval_status != ApprovalStatus.deleted.value,
        ).order_by(Receipt.captured_at.desc())
    ))
    # 照合候補 = 領収書(削除以外)。会社経費/立替どちらの領収書でも網羅とみなす。
    receipts = list(await session.scalars(
        select(Receipt).where(
            Receipt.client_id == client_id,
            Receipt.doc_type == "receipt",
            Receipt.approval_status != ApprovalStatus.deleted.value,
        )
    ))
    by_amount: dict = {}
    for r in receipts:
        if r.amount_jpy is not None:
            by_amount.setdefault(r.amount_jpy, []).append(r)

    # 重複アップロード検知: 同じ明細行(取引日＋金額＋利用先)をグループ化。最古を本体、残りを重複候補。
    groups: dict = defaultdict(list)
    for c in cards:
        if c.amount_jpy is None or c.captured_at is None:
            continue
        groups[(c.captured_at.date().isoformat(), c.amount_jpy, normalize_vendor(c.vendor))].append(c)
    dup_key: dict = {}
    dup_flag: dict = {}
    for members in groups.values():
        if len(members) < 2:
            continue
        members_sorted = sorted(members, key=lambda c: c.created_at)
        primary = members_sorted[0]
        for c in members_sorted:
            dup_key[c.id] = str(primary.id)  # グループ識別子(本体のid)
            dup_flag[c.id] = c.id != primary.id  # True=重複候補(削除してよい)

    imgs = await _images(session, [c.id for c in cards])
    out = []
    for c in cards:
        match = None
        if c.amount_jpy is not None and c.captured_at is not None:
            cd = c.captured_at.date()
            best = None
            for r in by_amount.get(c.amount_jpy, []):
                if r.captured_at is None:
                    continue
                dd = abs((r.captured_at.date() - cd).days)
                if dd <= _MATCH_DAYS and (best is None or dd < best[0]):
                    best = (dd, r)
            if best:
                match = best[1]
        fid, mime = imgs.get(c.id, (None, None))
        out.append({
            "id": str(c.id),
            "date": c.captured_at.date().isoformat() if c.captured_at else None,
            "vendor": c.vendor,
            "amount_jpy": c.amount_jpy,
            "has_receipt": match is not None,
            "receipt_id": str(match.id) if match else None,
            "image_file_id": str(fid) if fid else None,
            "image_mime": mime,
            "dup_key": dup_key.get(c.id),   # 同一なら重複グループ(本体のid)。null=単独
            "is_dup": dup_flag.get(c.id, False),  # True=重複候補
            "card_batch_id": str(c.card_batch_id) if c.card_batch_id else None,  # 取込バッチ(塊)
            "imported_at": c.created_at.isoformat() if c.created_at else None,  # 取込日時
        })
    return {
        "items": out,
        "total": len(out),
        "missing": sum(1 for x in out if not x["has_receipt"]),
        "dup_total": sum(1 for x in out if x["is_dup"]),  # 重複候補の件数
    }


@router.delete("/batch/{batch_id}")
async def delete_batch(
    batch_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """取込バッチ(塊)を一括削除。その card_batch_id の全明細行をソフト削除する。
    重複アップロードを行ごとに消す手間を無くすため。RLS でアクセス範囲を担保。"""
    rows = list(await session.scalars(
        select(Receipt).where(
            Receipt.card_batch_id == batch_id,
            Receipt.doc_type == "card_statement",
            Receipt.approval_status != ApprovalStatus.deleted.value,
        )
    ))
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "取込バッチが見つかりません")
    for r in rows:
        r.approval_status = ApprovalStatus.deleted.value
    return {"deleted": len(rows)}


class LabelBody(BaseModel):
    label: str = ""


@router.post("/batch/{batch_id}/label")
async def rename_batch(
    batch_id: UUID,
    body: LabelBody,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """取込バッチ(塊)の表示ラベルを変更する。空にすると既定(取込日)に戻る。
    ラベルは全明細行の capture_meta.card_batch_label に保持(全行が共有)。"""
    rows = list(await session.scalars(
        select(Receipt).where(
            Receipt.card_batch_id == batch_id,
            Receipt.doc_type == "card_statement",
            Receipt.approval_status != ApprovalStatus.deleted.value,
        )
    ))
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "取込バッチが見つかりません")
    label = (body.label or "").strip()
    for r in rows:
        cm = dict(r.capture_meta or {})
        if label:
            cm["card_batch_label"] = label
        else:
            cm.pop("card_batch_label", None)  # 空=既定(取込日)に戻す
        r.capture_meta = cm
    return {"label": label}
