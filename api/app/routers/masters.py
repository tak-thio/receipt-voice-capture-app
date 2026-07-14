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
from ..models import AccountTitle, Note, Partner, SubAccount

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
    pinned_debit: bool | None = None   # 「よく使う(借方)」: 仕分けの借方ピッカーで既定表示
    pinned_credit: bool | None = None  # 「よく使う(貸方)」: 仕分けの貸方ピッカーで既定表示
    # 他会計システムへの変換辞書 {"yayoi": {"name": ..., "code": ...}, ...}。行ごと丸ごと置換。
    export_map: dict | None = None


class PartnerIn(BaseModel):
    firm_id: UUID
    client_id: UUID
    name: str
    code: str | None = None
    t_number: str | None = None  # インボイス登録番号
    domain: str | None = None


class PartnerPatch(BaseModel):
    name: str | None = None
    code: str | None = None
    t_number: str | None = None  # インボイス登録番号
    domain: str | None = None


class SubAccountIn(BaseModel):
    code: str
    name: str
    sort_order: int = 0


class SubAccountPatch(BaseModel):
    code: str | None = None
    name: str | None = None
    sort_order: int | None = None


class NoteIn(BaseModel):
    firm_id: UUID
    client_id: UUID
    text: str
    color: str = "amber"
    sort_order: int = 0


class NotePatch(BaseModel):
    text: str | None = None
    color: str | None = None
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
    # 変換辞書の継承表示用: 顧問先行が override している事務所テンプレ行の export_map。
    tmpl_ids = [r.override_of for r in effective if r.override_of]
    tmpl_maps: dict = {}
    if tmpl_ids:
        trows = await session.scalars(select(AccountTitle).where(AccountTitle.id.in_(tmpl_ids)))
        tmpl_maps = {t.id: t.export_map for t in trows}
    return [
        {
            "id": str(r.id),
            "code": r.code,
            "name": r.name,
            "scope": "client" if r.client_id else "template",
            "sub_account_count": counts.get(r.id, 0),
            "pinned_debit": r.pinned_debit,
            "pinned_credit": r.pinned_credit,
            # 変換辞書: この行(顧問先の手動変更)と、継承元テンプレ(事務所の標準辞書)。
            "export_map": r.export_map,
            "override_of": str(r.override_of) if r.override_of else None,
            "template_export_map": tmpl_maps.get(r.override_of) if r.override_of else None,
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
    return [
        {"id": str(p.id), "code": p.code, "name": p.name, "t_number": p.t_number, "domain": p.domain}
        for p in rows
    ]


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
        t_number=body.t_number,
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
    return {"id": str(p.id), "code": p.code, "name": p.name, "t_number": p.t_number, "domain": p.domain}


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


# --- 付箋 (notes) ------------------------------------------------------------

@router.get("/notes")
async def list_notes(
    client_id: UUID | None = None,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Note).where(Note.active.is_(True))
    if client_id:
        stmt = stmt.where(Note.client_id == client_id)
    rows = await session.scalars(stmt.order_by(Note.sort_order, Note.created_at))
    return [{"id": str(n.id), "text": n.text, "color": n.color} for n in rows]


@router.post("/notes", status_code=201)
async def create_note(
    body: NoteIn,
    _: Principal = Depends(require_firm_role(*MASTER_EDITORS)),
    session: AsyncSession = Depends(get_session),
):
    note = Note(
        firm_id=body.firm_id,
        client_id=body.client_id,
        text=body.text,
        color=body.color,
        sort_order=body.sort_order,
    )
    session.add(note)
    await session.flush()
    return {"id": str(note.id), "text": note.text, "color": note.color}


@router.patch("/notes/{note_id}")
async def patch_note(
    note_id: UUID,
    body: NotePatch,
    _: Principal = Depends(require_firm_role(*MASTER_EDITORS)),
    session: AsyncSession = Depends(get_session),
):
    note = await session.get(Note, note_id)  # RLS scopes to the firm/client
    if not note:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "note not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(note, field, value)
    await session.flush()
    return {"id": str(note.id), "text": note.text, "color": note.color}


@router.delete("/notes/{note_id}")
async def delete_note(
    note_id: UUID,
    _: Principal = Depends(require_firm_role(*MASTER_EDITORS)),
    session: AsyncSession = Depends(get_session),
):
    note = await session.get(Note, note_id)
    if not note:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "note not found")
    note.active = False  # soft-delete: keep it referenced on past receipts
    await session.flush()
    return {"ok": True}
