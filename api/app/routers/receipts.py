"""Receipt list / detail / edit. Rows are RLS-scoped to the principal's tenants."""

from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import Principal, get_principal
from ..models import Receipt, ReceiptFile

router = APIRouter(prefix="/receipts", tags=["receipts"])


class ReceiptPatch(BaseModel):
    vendor: str | None = None
    amount_jpy: int | None = None
    tax_mode: str | None = None
    payment_method: str | None = None
    t_number: str | None = None
    account_title_id: UUID | None = None
    sub_account_id: UUID | None = None
    partner_id: UUID | None = None
    approval_status: str | None = None
    note_ids: list[str] | None = None  # 付箋: replace the attached set


def _serialize(r: Receipt, image_file_id=None) -> dict:
    return {
        "id": str(r.id),
        "client_id": str(r.client_id),
        "source": r.source,
        "captured_at": r.captured_at.isoformat() if r.captured_at else None,
        "vendor": r.vendor,
        "amount_jpy": r.amount_jpy,
        "tax_mode": r.tax_mode,
        "payment_method": r.payment_method,
        "t_number": r.t_number,
        "account_title_id": str(r.account_title_id) if r.account_title_id else None,
        "approval_status": r.approval_status,
        "journalized_at": r.journalized_at.isoformat() if r.journalized_at else None,
        "note_ids": r.note_ids or [],
        # The captured image (kind='capture'), so the UI can show/open it.
        "image_file_id": str(image_file_id) if image_file_id else None,
    }


@router.get("")
async def list_receipts(
    client_id: UUID | None = None,
    q: str | None = None,
    limit: int = 100,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Receipt).order_by(Receipt.created_at.desc()).limit(min(limit, 500))
    if client_id:
        stmt = stmt.where(Receipt.client_id == client_id)
    if q:
        stmt = stmt.where(text("search_text ILIKE :q")).params(q=f"%{q}%")
    rows = list(await session.scalars(stmt))
    # Map each receipt to its captured image file (if any) in one query.
    img_map: dict = {}
    if rows:
        rf = await session.execute(
            select(ReceiptFile.receipt_id, ReceiptFile.file_id).where(
                ReceiptFile.receipt_id.in_([r.id for r in rows]),
                ReceiptFile.kind == "capture",
            )
        )
        for rid, fid in rf.all():
            img_map.setdefault(rid, fid)
    return [_serialize(r, img_map.get(r.id)) for r in rows]


@router.get("/{receipt_id}")
async def get_receipt(
    receipt_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    r = await session.get(Receipt, receipt_id)
    if not r:
        return {"error": "not found"}
    img = await session.scalar(
        select(ReceiptFile.file_id).where(
            ReceiptFile.receipt_id == r.id, ReceiptFile.kind == "capture"
        )
    )
    return _serialize(r, img)


@router.patch("/{receipt_id}")
async def patch_receipt(
    receipt_id: UUID,
    body: ReceiptPatch,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    r = await session.get(Receipt, receipt_id)
    if not r:
        return {"error": "not found"}
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(r, field, value)
    await session.flush()
    return _serialize(r)
