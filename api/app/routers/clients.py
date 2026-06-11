"""顧問先 (client) management within a firm, plus its users."""

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import (
    Principal,
    can_admin_client,
    firm_id_of,
    get_principal,
    is_firm_owner,
    require_firm_role,
)
from ..models import Client, Membership, Role, User
from ..security import encrypt_secret, hash_password
from ..seed import seed_client_chart

router = APIRouter(prefix="/clients", tags=["clients"])

CLIENT_ROLES = {Role.client_admin.value, Role.client_accountant.value, Role.client_user.value}

# --- per-client AI provider config (same shape/handling as firm.ai_config) ---
SELF_HOSTED_AI = {"ollama", "whisper", "mock"}


class CapabilityConfig(BaseModel):
    provider: str
    key: str | None = None  # plaintext; encrypted server-side. Omit to keep existing.
    model: str | None = None


class AiConfigIn(BaseModel):
    stt: CapabilityConfig | None = None
    ocr: CapabilityConfig | None = None
    format: CapabilityConfig | None = None


def _mask_ai(ai_config: dict) -> dict:
    """Write-only view: provider/model + whether a key is set, never the key."""
    return {
        cap: {"provider": v.get("provider"), "model": v.get("model"), "key_set": bool(v.get("key_enc"))}
        for cap, v in (ai_config or {}).items()
    }

# Editable extended master fields on a client.
EDITABLE = (
    "name", "code", "export_default", "status", "entity_type", "t_number",
    "address", "phone", "contact_name", "fiscal_month", "industry", "memo",
    "staff_user_id",
)


class ClientIn(BaseModel):
    name: str
    code: str | None = None
    export_default: str = "generic"
    entity_type: str | None = None  # corporation | individual
    t_number: str | None = None
    address: str | None = None
    phone: str | None = None
    contact_name: str | None = None
    fiscal_month: int | None = None
    industry: str | None = None
    memo: str | None = None


class ClientPatch(BaseModel):
    name: str | None = None
    code: str | None = None
    export_default: str | None = None
    status: str | None = None
    entity_type: str | None = None  # corporation | individual
    t_number: str | None = None
    address: str | None = None
    phone: str | None = None
    contact_name: str | None = None
    fiscal_month: int | None = None
    industry: str | None = None
    memo: str | None = None
    staff_user_id: UUID | None = None


class RolePatch(BaseModel):
    role: str


class UserPatch(BaseModel):
    role: str | None = None
    status: str | None = None  # active | disabled
    name: str | None = None
    phone: str | None = None
    job_title: str | None = None  # 役職 (代表取締役/部長 等)
    email: str | None = None  # login ID (PC web login)
    password: str | None = None  # set/reset web password


class NewClientUser(BaseModel):
    name: str
    email: str | None = None  # login ID; omit for app-only (QR) users
    phone: str | None = None
    job_title: str | None = None  # 役職 (代表取締役/部長 等)
    role: str = Role.client_user.value
    password: str | None = None  # set if this user logs in on PC web


async def _guard_client(session: AsyncSession, principal: Principal, client_id: UUID) -> None:
    if not await can_admin_client(session, principal, client_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "cannot manage this client")


def _client_dict(c: Client) -> dict:
    return {
        "id": str(c.id),
        "name": c.name,
        "code": c.code,
        "export_default": c.export_default,
        "status": c.status,
        "entity_type": c.entity_type,
        "t_number": c.t_number,
        "address": c.address,
        "phone": c.phone,
        "contact_name": c.contact_name,
        "fiscal_month": c.fiscal_month,
        "industry": c.industry,
        "memo": c.memo,
        "staff_user_id": str(c.staff_user_id) if c.staff_user_id else None,
        "ai_config": _mask_ai(c.ai_config),
    }


@router.get("")
async def list_clients(
    q: str | None = None,
    include_archived: bool = False,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Client)
    if not include_archived:
        stmt = stmt.where(Client.status != "archived")
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Client.name.ilike(like), Client.code.ilike(like)))
    rows = await session.scalars(stmt.order_by(Client.name))
    return [
        {
            "id": str(c.id),
            "name": c.name,
            "code": c.code,
            "export_default": c.export_default,
            "status": c.status,
            "entity_type": c.entity_type,
            "fiscal_month": c.fiscal_month,
            "industry": c.industry,
        }
        for c in rows
    ]


@router.get("/{client_id}")
async def get_client(
    client_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    c = await session.get(Client, client_id)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client not found")
    return _client_dict(c)


@router.patch("/{client_id}/ai-config")
async def patch_client_ai_config(
    client_id: UUID,
    body: AiConfigIn,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """Set per-client AI provider keys. Allowed for 事務所職員(担当) and the client's
    own client_admin. Write-only: keys are encrypted and never returned (only key_set)."""
    await _guard_client(session, principal, client_id)
    c = await session.get(Client, client_id)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client not found")
    config = dict(c.ai_config or {})
    for cap in ("stt", "ocr", "format"):
        cfg: CapabilityConfig | None = getattr(body, cap)
        if cfg is None:
            continue
        entry: dict = {"provider": cfg.provider}
        if cfg.model:
            entry["model"] = cfg.model
        if cfg.provider in SELF_HOSTED_AI:
            pass  # no key needed
        elif cfg.key:
            entry["key_enc"] = encrypt_secret(cfg.key)
        elif config.get(cap, {}).get("key_enc"):
            entry["key_enc"] = config[cap]["key_enc"]  # keep existing key
        else:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"{cap}: provider {cfg.provider} requires a key"
            )
        config[cap] = entry
    c.ai_config = config  # reassign so SQLAlchemy detects the JSONB change
    return {"ai_config": _mask_ai(config)}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_client(
    body: ClientIn,
    principal: Principal = Depends(require_firm_role("firm_owner")),
    session: AsyncSession = Depends(get_session),
):
    # firm_owner only: a firm_staff isn't assigned to a brand-new client and so
    # couldn't see it (RLS) — client creation/assignment is an admin action.
    firm_membership = next((m for m in principal.memberships if m.client_id is None), None)
    if not firm_membership:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no firm-level membership")
    client = Client(firm_id=firm_membership.firm_id, name=body.name)
    for field, value in body.model_dump(exclude_unset=True).items():
        if field in EDITABLE:
            setattr(client, field, value)
    session.add(client)
    await session.flush()
    # Give the new client its own editable copy of the firm's standard chart
    # (overriding the inherited template rows so there are no duplicates).
    await seed_client_chart(session, client.firm_id, client.id)
    return {"id": str(client.id)}


@router.patch("/{client_id}")
async def patch_client(
    client_id: UUID,
    body: ClientPatch,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    await _guard_client(session, principal, client_id)
    c = await session.get(Client, client_id)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        if field in EDITABLE:
            setattr(c, field, value)
    await session.flush()
    return _client_dict(c)


@router.delete("/{client_id}")
async def delete_client(
    client_id: UUID,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """Soft-delete (archive) a client. firm_owner only — receipts/users are kept
    but the client drops out of lists. Restore by PATCH status='active'."""
    if not is_firm_owner(principal):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only a firm owner can delete a client")
    c = await session.get(Client, client_id)
    if not c or c.firm_id != firm_id_of(principal):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client not found")
    c.status = "archived"
    await session.flush()
    return {"ok": True}


@router.get("/{client_id}/users")
async def list_client_users(
    client_id: UUID,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    await _guard_client(session, principal, client_id)
    rows = await session.execute(
        select(User, Membership)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.client_id == client_id)
        .order_by(User.email)
    )
    return [
        {
            "user_id": str(u.id),
            "email": u.email,
            "name": u.name,
            "role": m.role,
            "phone": u.phone,
            "job_title": u.job_title,
            "status": u.status,
            # Placeholder logins (app-only QR users) aren't real login IDs.
            "login_id": None if u.email.endswith("@app.local") else u.email,
            "password_set": u.password_hash is not None,
        }
        for u, m in rows.all()
    ]


@router.post("/{client_id}/users", status_code=status.HTTP_201_CREATED)
async def create_client_user(
    client_id: UUID,
    body: NewClientUser,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """Create a named client user. Provide email+password for someone who logs
    in on PC web (e.g. 経理担当者); omit them for an app-only person who pairs a
    device via QR (a placeholder login ID is generated)."""
    await _guard_client(session, principal, client_id)
    if body.role not in CLIENT_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid client role")
    client = await session.get(Client, client_id)
    if not client:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client not found")
    email = (body.email or "").strip() or f"app-{uuid4().hex[:12]}@app.local"
    if await session.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")
    user = User(
        email=email,
        name=body.name,
        phone=body.phone,
        job_title=body.job_title,
        password_hash=hash_password(body.password) if body.password else None,
    )
    session.add(user)
    await session.flush()
    session.add(
        Membership(user_id=user.id, firm_id=client.firm_id, client_id=client.id, role=body.role)
    )
    return {"user_id": str(user.id), "email": email, "name": body.name}


@router.patch("/{client_id}/users/{user_id}")
async def patch_client_user(
    client_id: UUID,
    user_id: UUID,
    body: UserPatch,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """Update a client user: role and/or profile (name/phone) and 有効/無効."""
    await _guard_client(session, principal, client_id)
    m = await session.scalar(
        select(Membership).where(
            Membership.client_id == client_id, Membership.user_id == user_id
        )
    )
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client user not found")
    if body.role is not None:
        if body.role not in CLIENT_ROLES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid client role")
        m.role = body.role
    user_fields = (body.status, body.name, body.phone, body.job_title, body.email, body.password)
    if any(v is not None for v in user_fields):
        user = await session.get(User, user_id)
        if body.status is not None:
            if body.status not in ("active", "disabled"):
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid status")
            user.status = body.status
        if body.name is not None:
            user.name = body.name
        if body.phone is not None:
            user.phone = body.phone
        if body.job_title is not None:
            user.job_title = body.job_title
        if body.email is not None:
            email = body.email.strip()
            if not email:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "email cannot be empty")
            clash = await session.scalar(
                select(User).where(User.email == email, User.id != user_id)
            )
            if clash:
                raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")
            user.email = email
        if body.password:
            user.password_hash = hash_password(body.password)
    return {"ok": True}


@router.delete("/{client_id}/users/{user_id}")
async def remove_client_user(
    client_id: UUID,
    user_id: UUID,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    await _guard_client(session, principal, client_id)
    m = await session.scalar(
        select(Membership).where(
            Membership.client_id == client_id, Membership.user_id == user_id
        )
    )
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client user not found")
    await session.delete(m)
    return {"ok": True}
