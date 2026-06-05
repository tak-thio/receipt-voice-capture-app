"""CSV export for accounting software.

TODO(Phase 1): port the mobile app's formatters
(receipt-voice-capture-app/src/services/export/formatters/*: freee, yayoi, mas,
generic) to Python here, so the PC web app can export a client's journalized
receipts. Output respects clients.export_default.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import Principal, get_principal
from ..models import Receipt

router = APIRouter(prefix="/export", tags=["export"])

SUPPORTED_FORMATS = ["generic", "mas", "freee", "yayoi"]


@router.get("")
async def export_csv(
    client_id: UUID,
    format: str = "generic",
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    rows = await session.scalars(
        select(Receipt).where(
            Receipt.client_id == client_id, Receipt.journalized_at.is_not(None)
        )
    )
    # Placeholder generic CSV until the real formatters are ported.
    lines = ["date,vendor,amount_jpy,t_number"]
    for r in rows:
        date = r.captured_at.date().isoformat() if r.captured_at else ""
        lines.append(f"{date},{r.vendor or ''},{r.amount_jpy or ''},{r.t_number or ''}")
    csv = "\n".join(lines) + "\n"
    return Response(
        content=csv,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=export_{format}.csv"},
    )
