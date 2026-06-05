"""Default firm-level master template (勘定科目).

Seeded once per firm at registration as account_titles with client_id = NULL.
Clients inherit these via the template+override overlay (see masters router), so
no per-client copy is needed — a client only adds rows to override/extend.
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from .models import AccountTitle

# Common expense account titles (code, name). Codes are illustrative defaults
# the firm can edit. Ported in spirit from receipt-app's seeded chart.
DEFAULT_ACCOUNT_TITLES: list[tuple[str, str]] = [
    ("758", "旅費交通費"),
    ("759", "消耗品費"),
    ("760", "通信費"),
    ("761", "接待交際費"),
    ("762", "会議費"),
    ("763", "新聞図書費"),
    ("764", "荷造運賃"),
    ("765", "支払手数料"),
    ("766", "水道光熱費"),
    ("767", "地代家賃"),
    ("768", "広告宣伝費"),
    ("769", "福利厚生費"),
    ("790", "雑費"),
]


async def seed_firm_template(session: AsyncSession, firm_id: UUID) -> None:
    """Insert the default account-title template for a firm (client_id = NULL).

    Caller must have already bound the RLS context to a firm member (so the
    WITH CHECK policy passes).
    """
    for order, (code, name) in enumerate(DEFAULT_ACCOUNT_TITLES):
        session.add(
            AccountTitle(
                firm_id=firm_id,
                client_id=None,
                code=code,
                name=name,
                sort_order=order,
            )
        )
