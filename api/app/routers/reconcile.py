"""突き合わせ (自動重複): 同じ取引(同日+同金額、領収書は+取引先)を自動で1つに
まとめる。引き当て操作は無く、既定で重複扱い(親=領収書優先のみ pending、他は
duplicate=仕分け/元帳から除外)。利用者は子の「重複ではない」で外せる。

判定・親選び・自動適用のロジックは app/dedup.py。ここは表示と「重複ではない/戻す」だけ。
"""

from collections import defaultdict
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import dedup
from ..db import get_session
from ..deps import Principal, get_principal
from ..models import File, Receipt, ReceiptFile

router = APIRouter(prefix="/reconcile", tags=["reconcile"])


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


def _item(r: Receipt, imgs: dict) -> dict:
    fid, mime = imgs.get(r.id, (None, None))
    return {
        "id": str(r.id),
        "doc_type": r.doc_type,  # 'receipt' | 'card_statement'
        "source": r.source,
        "date": r.captured_at.date().isoformat() if r.captured_at else None,
        "vendor": r.vendor,
        "partner": r.partner_name or r.vendor,  # 取引先(表示)
        "amount_jpy": r.amount_jpy,
        "t_number": r.t_number,
        "journalized_at": r.journalized_at.isoformat() if r.journalized_at else None,
        "image_file_id": str(fid) if fid else None,
        "image_mime": mime,
    }


@router.get("")
async def reconcile(
    client_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """自動重複を再計算してから、まとめられたグループ(親+重複の子)を返す。"""
    await dedup.recompute_dedup(session, client_id)

    rows = list(
        await session.scalars(
            select(Receipt).where(
                Receipt.client_id == client_id,
                Receipt.match_id.is_not(None),
                Receipt.approval_status.in_(["pending", "duplicate"]),
            )
        )
    )
    imgs = await _images(session, [r.id for r in rows])

    groups: dict = defaultdict(list)
    for r in rows:
        groups[str(r.match_id)].append(r)

    out = []
    for mid, members in groups.items():
        primary = next((m for m in members if m.approval_status == "pending"), None)
        dups = [m for m in members if m.approval_status == "duplicate"]
        if primary is None or not dups:
            continue  # 親が無い/重複が無いグループは表示しない
        out.append(
            {
                "match_id": mid,
                "primary": _item(primary, imgs),
                "duplicates": [_item(m, imgs) for m in dups],
            }
        )
    return {"groups": out}


class ReceiptRef(BaseModel):
    receipt_id: UUID


@router.post("/not-duplicate")
async def not_duplicate(
    body: ReceiptRef,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """この行は「重複ではない」= グループから外して独立させる(以後まとめ直さない)。"""
    r = await session.get(Receipt, body.receipt_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "receipt not found")
    r.capture_meta = {**(r.capture_meta or {}), "dedup_split": True}
    await dedup.recompute_dedup(session, r.client_id)
    return {"ok": True}


@router.post("/remerge")
async def remerge(
    body: ReceiptRef,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """「重複ではない」を取り消して、自動まとめの対象に戻す。"""
    r = await session.get(Receipt, body.receipt_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "receipt not found")
    cm = dict(r.capture_meta or {})
    cm.pop("dedup_split", None)
    r.capture_meta = cm
    await dedup.recompute_dedup(session, r.client_id)
    return {"ok": True}
