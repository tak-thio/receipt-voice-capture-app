"""Masters: account titles (firm template + client override) and partners.

Account titles resolve as: firm-template rows (client_id NULL) overlaid with the
client's own rows (client_id set). A client row with `override_of` set hides the
referenced template row.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import Principal, get_principal, require_firm_role
from ..models import AccountTitle, Partner, SubAccount

router = APIRouter(prefix="/masters", tags=["masters"])

MASTER_EDITORS = ("firm_owner", "firm_staff", "client_admin")


class AccountTitleIn(BaseModel):
    firm_id: UUID
    client_id: UUID | None = None
    code: str
    name: str
    sort_order: int = 0
    override_of: UUID | None = None


class AccountTitlePatch(BaseModel):
    code: str | None = None
    name: str | None = None
    sort_order: int | None = None


class PartnerIn(BaseModel):
    firm_id: UUID
    client_id: UUID
    name: str
    code: str | None = None
    domain: str | None = None


class PartnerPatch(BaseModel):
    name: str | None = None
    code: str | None = None
    domain: str | None = None


class SubAccountIn(BaseModel):
    code: str
    name: str
    sort_order: int = 0


class SubAccountPatch(BaseModel):
    code: str | None = None
    name: str | None = None
    sort_order: int | None = None


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

    # Sub-account counts per (effective) account title, for the UI badge.
    title_ids = [r.id for r in effective]
    counts: dict[UUID, int] = {}
    if title_ids:
        crows = await session.execute(
            select(SubAccount.account_title_id, func.count())
            .where(SubAccount.active.is_(True), SubAccount.account_title_id.in_(title_ids))
            .group_by(SubAccount.account_title_id)
        )
        counts = {tid: n for tid, n in crows.all()}
    return [
        {
            "id": str(r.id),
            "code": r.code,
            "name": r.name,
            "scope": "client" if r.client_id else "template",
            "sub_account_count": counts.get(r.id, 0),
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


@router.patch("/account-titles/{title_id}")
async def patch_account_title(
    title_id: UUID,
    body: AccountTitlePatch,
    _: Principal = Depends(require_firm_role(*MASTER_EDITORS)),
    session: AsyncSession = Depends(get_session),
):
    at = await session.get(AccountTitle, title_id)  # RLS scopes to the firm
    if not at:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account title not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(at, field, value)
    await session.flush()
    return {"id": str(at.id), "code": at.code, "name": at.name}


@router.delete("/account-titles/{title_id}")
async def delete_account_title(
    title_id: UUID,
    _: Principal = Depends(require_firm_role(*MASTER_EDITORS)),
    session: AsyncSession = Depends(get_session),
):
    at = await session.get(AccountTitle, title_id)
    if not at:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account title not found")
    at.active = False  # soft-delete: keep journal history intact
    await session.flush()
    return {"ok": True}


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


@router.post("/partners", status_code=201)
async def create_partner(
    body: PartnerIn,
    _: Principal = Depends(require_firm_role("firm_owner", "firm_staff", "client_admin")),
    session: AsyncSession = Depends(get_session),
):
    partner = Partner(
        firm_id=body.firm_id,
        client_id=body.client_id,
        name=body.name,
        code=body.code,
        domain=body.domain,
    )
    session.add(partner)
    await session.flush()
    return {"id": str(partner.id)}


@router.patch("/partners/{partner_id}")
async def patch_partner(
    partner_id: UUID,
    body: PartnerPatch,
    _: Principal = Depends(require_firm_role(*MASTER_EDITORS)),
    session: AsyncSession = Depends(get_session),
):
    p = await session.get(Partner, partner_id)  # RLS scopes to the firm
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "partner not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(p, field, value)
    await session.flush()
    return {"id": str(p.id), "code": p.code, "name": p.name, "domain": p.domain}


@router.delete("/partners/{partner_id}")
async def delete_partner(
    partner_id: UUID,
    _: Principal = Depends(require_firm_role(*MASTER_EDITORS)),
    session: AsyncSession = Depends(get_session),
):
    p = await session.get(Partner, partner_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "partner not found")
    p.active = False  # soft-delete: keep partner history / aliases intact
    await session.flush()
    return {"ok": True}


# --- sub-accounts (補助科目) -------------------------------------------------
# A 補助科目 belongs to an account title (its account_title_id). They are
# managed per client (the account title is a client row), so no template overlay
# is needed in practice — list straight by the parent account title.

@router.get("/account-titles/{title_id}/sub-accounts")
async def list_sub_accounts(
    title_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    title = await session.get(AccountTitle, title_id)  # RLS scopes to the firm
    if not title:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account title not found")
    rows = await session.scalars(
        select(SubAccount)
        .where(SubAccount.account_title_id == title_id, SubAccount.active.is_(True))
        .order_by(SubAccount.sort_order, SubAccount.code)
    )
    return [{"id": str(s.id), "code": s.code, "name": s.name} for s in rows]


@router.post("/account-titles/{title_id}/sub-accounts", status_code=201)
async def create_sub_account(
    title_id: UUID,
    body: SubAccountIn,
    _: Principal = Depends(require_firm_role(*MASTER_EDITORS)),
    session: AsyncSession = Depends(get_session),
):
    title = await session.get(AccountTitle, title_id)
    if not title:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account title not found")
    sub = SubAccount(
        firm_id=title.firm_id,
        client_id=title.client_id,  # inherit the parent title's scope
        account_title_id=title.id,
        code=body.code,
        name=body.name,
        sort_order=body.sort_order,
    )
    session.add(sub)
    await session.flush()
    return {"id": str(sub.id), "code": sub.code, "name": sub.name}


@router.patch("/sub-accounts/{sub_id}")
async def patch_sub_account(
    sub_id: UUID,
    body: SubAccountPatch,
    _: Principal = Depends(require_firm_role(*MASTER_EDITORS)),
    session: AsyncSession = Depends(get_session),
):
    sub = await session.get(SubAccount, sub_id)  # RLS scopes to the firm
    if not sub:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sub-account not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(sub, field, value)
    await session.flush()
    return {"id": str(sub.id), "code": sub.code, "name": sub.name}


@router.delete("/sub-accounts/{sub_id}")
async def delete_sub_account(
    sub_id: UUID,
    _: Principal = Depends(require_firm_role(*MASTER_EDITORS)),
    session: AsyncSession = Depends(get_session),
):
    sub = await session.get(SubAccount, sub_id)
    if not sub:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sub-account not found")
    sub.active = False  # soft-delete
    await session.flush()
    return {"ok": True}
