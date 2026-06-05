"""仕分け (journaling) queue, suggestion, and confirm/learn.

Engine lives in app/journaling.py. The queue returns rich items (with image and
a per-item suggestion) so the web app can render receipt-app's single-item
"拡大表示" journaling UX. Rows are RLS-isolated to the principal's tenants.
"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import journaling
from ..db import get_session
from ..deps import Principal, get_principal
from ..models import Receipt, ReceiptFile

router = APIRouter(prefix="/journal", tags=["journal"])


class Journalize(BaseModel):
    account_title_id: UUID | None = None
    sub_account_id: UUID | None = None
    partner_id: UUID | None = None


async def _image_file_id(session: AsyncSession, receipt_id: UUID) -> UUID | None:
    return await session.scalar(
        select(ReceiptFile.file_id).where(
            ReceiptFile.receipt_id == receipt_id, ReceiptFile.kind == "capture"
        )
    )


@router.get("/queue")
async def queue(
    client_id: UUID | None = None,
    view: str = "queue",  # "queue" (un-held) | "held"
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    held = view == "held"
    conds = [Receipt.journalized_at.is_(None)]
    if client_id:
        conds.append(Receipt.client_id == client_id)

    rows = list(
        await session.scalars(
            select(Receipt)
            .where(*conds, Receipt.journal_hold.is_(held))
            .order_by(Receipt.captured_at.desc())
            .limit(50)
        )
    )
    total = await session.scalar(
        select(func.count(Receipt.id)).where(*conds, Receipt.journal_hold.is_(held))
    )
    held_count = await session.scalar(
        select(func.count(Receipt.id)).where(*conds, Receipt.journal_hold.is_(True))
    )

    items = []
    for r in rows:
        suggestion = await journaling.suggest(session, r)
        img = await _image_file_id(session, r.id)
        items.append(
            {
                "id": str(r.id),
                "vendor": r.vendor,
                "amount_jpy": r.amount_jpy,
                "date": r.captured_at.date().isoformat() if r.captured_at else None,
                "source": r.source,
                "t_number": r.t_number,
                "image_file_id": str(img) if img else None,
                "account_title_id": str(r.account_title_id) if r.account_title_id else None,
                "partner_id": str(r.partner_id) if r.partner_id else None,
                "suggestion": {
                    "account_title_id": str(suggestion["account_title_id"])
                    if suggestion["account_title_id"]
                    else None,
                    "partner_id": str(suggestion["partner_id"]) if suggestion["partner_id"] else None,
                },
            }
        )

    return {"items": items, "total": total or 0, "held_count": held_count or 0}


@router.get("/suggest/{receipt_id}")
async def suggest(
    receipt_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    receipt = await session.get(Receipt, receipt_id)
    if not receipt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "receipt not found")
    result = await journaling.suggest(session, receipt)
    return {k: (str(v) if v else None) for k, v in result.items()}


@router.post("/receipts/{receipt_id}")
async def journalize(
    receipt_id: UUID,
    body: Journalize,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """Confirm a receipt's categorization, mark journalized, and learn."""
    receipt = await session.get(Receipt, receipt_id)
    if not receipt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "receipt not found")

    receipt.account_title_id = body.account_title_id
    receipt.sub_account_id = body.sub_account_id
    receipt.partner_id = body.partner_id
    receipt.journalized_at = datetime.now(timezone.utc)
    receipt.journal_hold = False

    await journaling.learn_partner(session, receipt, body.partner_id)
    await session.flush()
    return {"id": str(receipt.id), "journalized_at": receipt.journalized_at.isoformat()}


async def _set_hold(session: AsyncSession, receipt_id: UUID, hold: bool):
    receipt = await session.get(Receipt, receipt_id)
    if not receipt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "receipt not found")
    receipt.journal_hold = hold
    await session.flush()
    return {"id": str(receipt.id), "journal_hold": hold}


@router.post("/receipts/{receipt_id}/hold")
async def hold(
    receipt_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    return await _set_hold(session, receipt_id, True)


@router.post("/receipts/{receipt_id}/unhold")
async def unhold(
    receipt_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    return await _set_hold(session, receipt_id, False)
