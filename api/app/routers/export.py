"""CSV export for accounting software (freee / 弥生 / MJS-MAS / 汎用).

Formatters are ported from the mobile app (see app/export/formatters.py).
Exports a client's journalized receipts; output respects clients.export_default
unless `format` is given.
"""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import Response

from ..db import get_session
from ..deps import Principal, get_principal
from ..export import formatters
from ..models import AccountTitle, Client, Partner, Receipt

router = APIRouter(prefix="/export", tags=["export"])

SUPPORTED_FORMATS = list(formatters.FORMATTERS.keys())


@router.get("")
async def export_csv(
    client_id: UUID,
    format: str | None = None,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    client = await session.get(Client, client_id)
    target = format or (client.export_default if client else "generic")

    receipts = list(
        await session.scalars(
            select(Receipt)
            .where(Receipt.client_id == client_id, Receipt.journalized_at.is_not(None))
            .order_by(Receipt.captured_at)
        )
    )

    # Resolve account-title / partner names referenced by the receipts.
    title_ids = {r.account_title_id for r in receipts if r.account_title_id}
    partner_ids = {r.partner_id for r in receipts if r.partner_id}
    titles = {
        t.id: t.name
        for t in await session.scalars(select(AccountTitle).where(AccountTitle.id.in_(title_ids)))
    } if title_ids else {}
    partners = {
        p.id: p.name
        for p in await session.scalars(select(Partner).where(Partner.id.in_(partner_ids)))
    } if partner_ids else {}

    rows = [
        formatters.RowView(
            date=r.captured_at.date().isoformat() if r.captured_at else "",
            vendor=r.vendor or "",
            amount=str(r.amount_jpy) if r.amount_jpy is not None else "",
            tax_mode=r.tax_mode,
            account=titles.get(r.account_title_id, ""),
            payment_method=r.payment_method or "",
            t_number=r.t_number or "",
            description=partners.get(r.partner_id) or r.vendor or "",
        )
        for r in receipts
    ]

    headers, body = formatters.build(target, rows)
    csv = formatters.to_csv(headers, body)
    return Response(
        content=csv,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{target}.csv"'},
    )
