"""仕分け (journaling) queue, suggestion, and confirm/learn.

Engine lives in app/journaling.py (ported from receipt-app, adapted for mobile
+ multi-tenant). Rows are RLS-isolated to the principal's tenants.
"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import journaling
from ..db import get_session
from ..deps import Principal, get_principal
from ..models import Receipt

router = APIRouter(prefix="/journal", tags=["journal"])


class Journalize(BaseModel):
    account_title_id: UUID | None = None
    sub_account_id: UUID | None = None
    partner_id: UUID | None = None


@router.get("/queue")
async def queue(
    client_id: UUID | None = None,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """Un-journalized, non-held receipts awaiting categorization."""
    stmt = (
        select(Receipt)
        .where(Receipt.journalized_at.is_(None), Receipt.journal_hold.is_(False))
        .order_by(Receipt.captured_at.desc())
        .limit(100)
    )
    if client_id:
        stmt = stmt.where(Receipt.client_id == client_id)
    rows = await session.scalars(stmt)
    return [{"id": str(r.id), "vendor": r.vendor, "amount_jpy": r.amount_jpy} for r in rows]


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


@router.post("/receipts/{receipt_id}/hold")
async def hold(
    receipt_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    receipt = await session.get(Receipt, receipt_id)
    if not receipt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "receipt not found")
    receipt.journal_hold = True
    await session.flush()
    return {"id": str(receipt.id), "journal_hold": True}
