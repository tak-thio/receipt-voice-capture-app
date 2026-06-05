"""Masters: account titles (firm template + client override) and partners.

Account titles resolve as: firm-template rows (client_id NULL) overlaid with the
client's own rows (client_id set). A client row with `override_of` set hides the
referenced template row.
"""

from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import Principal, get_principal, require_firm_role
from ..models import AccountTitle, Partner

router = APIRouter(prefix="/masters", tags=["masters"])


class AccountTitleIn(BaseModel):
    firm_id: UUID
    client_id: UUID | None = None
    code: str
    name: str
    sort_order: int = 0
    override_of: UUID | None = None


@router.get("/account-titles")
async def list_account_titles(
    client_id: UUID | None = None,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """Effective list for a client = template (client_id NULL) + client rows,
    minus any template rows overridden by a client row."""
    stmt = select(AccountTitle).where(AccountTitle.active.is_(True))
    if client_id:
        stmt = stmt.where(
            or_(AccountTitle.client_id.is_(None), AccountTitle.client_id == client_id)
        )
    rows = list(await session.scalars(stmt.order_by(AccountTitle.sort_order)))
    overridden = {r.override_of for r in rows if r.override_of}
    effective = [r for r in rows if r.id not in overridden]
    return [
        {
            "id": str(r.id),
            "code": r.code,
            "name": r.name,
            "scope": "client" if r.client_id else "template",
        }
        for r in effective
    ]


@router.post("/account-titles", status_code=201)
async def create_account_title(
    body: AccountTitleIn,
    _: Principal = Depends(require_firm_role("firm_owner", "firm_staff", "client_admin")),
    session: AsyncSession = Depends(get_session),
):
    at = AccountTitle(
        firm_id=body.firm_id,
        client_id=body.client_id,
        code=body.code,
        name=body.name,
        sort_order=body.sort_order,
        override_of=body.override_of,
    )
    session.add(at)
    await session.flush()
    return {"id": str(at.id)}


@router.get("/partners")
async def list_partners(
    client_id: UUID | None = None,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Partner).where(Partner.active.is_(True))
    if client_id:
        stmt = stmt.where(Partner.client_id == client_id)
    rows = await session.scalars(stmt.order_by(Partner.name))
    return [{"id": str(p.id), "code": p.code, "name": p.name, "domain": p.domain} for p in rows]
