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
    # 外貨の照合キー=(通貨, 現地額)。円は発行者/カード会社でレートが違い一致しないため、
    # 外貨行は現地額($220↔$220)で突き合わせる。Numeric(14,2)同士なので str() 表現は揃う。
    by_fx: dict = {}
    for r in receipts:
        if r.amount_jpy is not None:
            by_amount.setdefault(r.amount_jpy, []).append(r)
        if r.currency and r.currency != "JPY" and r.foreign_amount is not None:
            by_fx.setdefault((r.currency, str(r.foreign_amount)), []).append(r)

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
    receipt_by_id = {r.id: r for r in receipts}
    # ① 手動の紐付け/「領収書なし」確定を先に反映(capture_meta.link_manual)。使った領収書は予約。
    manual_match: dict = {}   # card.id -> Receipt(手動リンク)
    manual_none: set = set()  # card.id (手動で「領収書なし」確定)
    reserved: set = set()     # 手動で使われた領収書id(自動割当から除外)
    for c in cards:
        cm = c.capture_meta or {}
        if not cm.get("link_manual"):
            continue
        rid = cm.get("linked_receipt_id")
        r = None
        if rid:
            try:
                r = receipt_by_id.get(UUID(rid))
            except (ValueError, TypeError):
                r = None
        if r is not None:
            manual_match[c.id] = r
            reserved.add(r.id)
        else:
            manual_none.add(c.id)  # 手動指定だが領収書なし(or 紐付け先が消えた)
    # ② 自動: 手動でない行に、予約外の領収書を「1枚=1明細・近い日付優先」で割当(消費)。
    #    外貨行は (通貨, 現地額) 一致を優先し、無ければ従来の円一致にフォールバック。
    used: set = set(reserved)
    auto_match: dict = {}

    def _closest(cands, cd, exclude):
        best = None
        for r in cands:
            if r.id in exclude or r.captured_at is None:
                continue
            dd = abs((r.captured_at.date() - cd).days)
            if dd <= _MATCH_DAYS and (best is None or dd < best[0]):
                best = (dd, r)
        return best[1] if best else None

    for c in cards:
        if c.id in manual_match or c.id in manual_none or c.captured_at is None:
            continue
        cd = c.captured_at.date()
        hit = None
        if c.currency and c.currency != "JPY" and c.foreign_amount is not None:
            hit = _closest(by_fx.get((c.currency, str(c.foreign_amount)), []), cd, used)
        if hit is None and c.amount_jpy is not None:
            hit = _closest(by_amount.get(c.amount_jpy, []), cd, used)
        if hit is not None:
            auto_match[c.id] = hit
            used.add(hit.id)

    out = []
    for c in cards:
        if c.id in manual_match:
            match, manual = manual_match[c.id], True
        elif c.id in manual_none:
            match, manual = None, True
        else:
            match, manual = auto_match.get(c.id), False
        fid, mime = imgs.get(c.id, (None, None))
        out.append({
            "id": str(c.id),
            "date": c.captured_at.date().isoformat() if c.captured_at else None,
            "vendor": c.vendor,
            "amount_jpy": c.amount_jpy,
            # 外貨行のみ値が入る(通貨名・現地ご利用額・換算レート=明細の印字値)。
            "currency": c.currency,
            "foreign_amount": float(c.foreign_amount) if c.foreign_amount is not None else None,
            "exchange_rate": float(c.exchange_rate) if c.exchange_rate is not None else None,
            "has_receipt": match is not None,
            "receipt_id": str(match.id) if match else None,
            "link_manual": manual,  # True=人が設定(紐付け/領収書なし確定) / False=システム自動
            "image_file_id": str(fid) if fid else None,
            "image_mime": mime,
            "dup_key": dup_key.get(c.id),   # 同一なら重複グループ(本体のid)。null=単独
            "is_dup": dup_flag.get(c.id, False),  # True=重複候補
            "card_batch_id": str(c.card_batch_id) if c.card_batch_id else None,  # 取込バッチ(塊)
            "imported_at": c.created_at.isoformat() if c.created_at else None,  # 取込日時
            "card_batch_label": (c.capture_meta or {}).get("card_batch_label"),  # バッチ名(未設定なら既定=取込日)
        })
    return {
        "items": out,
        "total": len(out),
        "missing": sum(1 for x in out if not x["has_receipt"]),
        "dup_total": sum(1 for x in out if x["is_dup"]),  # 重複候補の件数
        # 要対応 = 領収書なし かつ 手動確定でない(未確定)。ここが無限に溜まる分。
        "unresolved": sum(1 for x in out if not x["has_receipt"] and not x["link_manual"]),
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


class LinkBody(BaseModel):
    mode: str = "auto"            # 'receipt' | 'none' | 'auto'
    receipt_id: str | None = None


@router.post("/{line_id}/link")
async def set_line_link(
    line_id: UUID,
    body: LinkBody,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """明細行の領収書紐付けを手動設定。mode: receipt=指定領収書に紐付け / none=「領収書なし」確定 /
    auto=自動照合に戻す。手動設定は capture_meta(link_manual, linked_receipt_id)に保存し、自動より優先。"""
    c = await session.get(Receipt, line_id)
    if c is None or c.doc_type != "card_statement":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "明細行が見つかりません")
    cm = dict(c.capture_meta or {})
    if body.mode == "receipt" and body.receipt_id:
        cm["link_manual"] = True
        cm["linked_receipt_id"] = body.receipt_id
    elif body.mode == "none":
        cm["link_manual"] = True
        cm.pop("linked_receipt_id", None)
    else:  # auto
        cm.pop("link_manual", None)
        cm.pop("linked_receipt_id", None)
    c.capture_meta = cm
    return {"ok": True, "mode": body.mode}
