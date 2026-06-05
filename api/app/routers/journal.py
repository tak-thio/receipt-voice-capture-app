"""仕分け (journaling) queue and confirm/learn.

TODO(Phase 1): port receipt-app's app/journal.py:
  - suggest(): partner lookup (alias -> domain -> name fuzzy) + rule scoring
  - learn():   upsert journal_rules / partner_aliases on confirm
Scoped per client_id; rows are RLS-isolated.
"""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import Principal, get_principal
from ..models import Receipt

router = APIRouter(prefix="/journal", tags=["journal"])


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
