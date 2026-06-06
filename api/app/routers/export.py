"""CSV export for accounting software (freee / 弥生 / MJS-MAS / 汎用).

Formatters are ported from the mobile app (see app/export/formatters.py).
Exports a client's journalized receipts; output respects clients.export_default
unless `format` is given.
"""

import csv
import io
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import Response

from ..db import get_session
from ..deps import Principal, get_principal
from ..export import formatters
from ..models import AccountTitle, Client, Partner, Receipt, SubAccount

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


@router.get("/ledger")
async def export_ledger(
    client_id: UUID,
    date_from: str | None = None,
    date_to: str | None = None,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """総勘定元帳(科目別)CSV: journalized receipts grouped by account title,
    each group with a 小計 and a final 合計. Optional date range (YYYY-MM-DD on
    the captured date). RLS scopes rows to the principal's tenant."""
    receipts = list(
        await session.scalars(
            select(Receipt).where(
                Receipt.client_id == client_id, Receipt.journalized_at.is_not(None)
            )
        )
    )
    if date_from:
        receipts = [r for r in receipts if r.captured_at and r.captured_at.date().isoformat() >= date_from]
    if date_to:
        receipts = [r for r in receipts if r.captured_at and r.captured_at.date().isoformat() <= date_to]

    title_ids = {r.account_title_id for r in receipts if r.account_title_id}
    titles = {
        t.id: t for t in await session.scalars(select(AccountTitle).where(AccountTitle.id.in_(title_ids)))
    } if title_ids else {}
    sub_ids = {r.sub_account_id for r in receipts if r.sub_account_id}
    subs = {
        s.id: s.name for s in await session.scalars(select(SubAccount).where(SubAccount.id.in_(sub_ids)))
    } if sub_ids else {}
    partner_ids = {r.partner_id for r in receipts if r.partner_id}
    partners = {
        p.id: p.name for p in await session.scalars(select(Partner).where(Partner.id.in_(partner_ids)))
    } if partner_ids else {}

    def sort_key(r: Receipt):
        t = titles.get(r.account_title_id)
        return (
            t.sort_order if t else 9999,
            t.code if t else "",
            r.captured_at.date().isoformat() if r.captured_at else "",
        )

    receipts.sort(key=sort_key)

    buf = io.StringIO()
    buf.write("﻿")  # UTF-8 BOM so Excel opens Japanese correctly
    w = csv.writer(buf)
    w.writerow(["日付", "科目コード", "勘定科目", "補助科目", "取引先", "摘要", "税区分", "インボイス番号", "金額"])

    cur = None
    subtotal = 0
    grand = 0
    for r in receipts:
        if r.account_title_id != cur:
            if cur is not None:
                w.writerow(["", "", "", "", "", "", "", "小計", subtotal])
            cur = r.account_title_id
            subtotal = 0
        t = titles.get(r.account_title_id)
        amt = r.amount_jpy or 0
        subtotal += amt
        grand += amt
        w.writerow([
            r.captured_at.date().isoformat() if r.captured_at else "",
            t.code if t else "",
            t.name if t else "(未設定)",
            subs.get(r.sub_account_id, ""),
            partners.get(r.partner_id, ""),
            r.vendor or "",
            r.tax_mode or "",
            r.t_number or "",
            amt,
        ])
    if cur is not None:
        w.writerow(["", "", "", "", "", "", "", "小計", subtotal])
    w.writerow(["", "", "", "", "", "", "", "合計", grand])

    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="ledger.csv"'},
    )
