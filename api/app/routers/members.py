"""Firm staff (firm-level memberships) management."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import Principal, firm_id_of, get_principal, require_firm_role
from ..models import Client, Membership, Role, StaffClient, User
from ..security import hash_password

router = APIRouter(prefix="/members", tags=["members"])

FIRM_ROLES = {Role.firm_owner.value, Role.firm_staff.value}


class NewMember(BaseModel):
    name: str
    email: str  # login ID
    password: str
    role: str = Role.firm_staff.value


class MemberPatch(BaseModel):
    role: str | None = None
    name: str | None = None
    email: str | None = None
    password: str | None = None  # set/reset web password


class AssignClients(BaseModel):
    client_ids: list[UUID]


async def _firm_membership(session: AsyncSession, firm_id, user_id) -> Membership | None:
    return await session.scalar(
        select(Membership).where(
            Membership.firm_id == firm_id,
            Membership.user_id == user_id,
            Membership.client_id.is_(None),
        )
    )


async def _owner_count(session: AsyncSession, firm_id) -> int:
    return await session.scalar(
        select(func.count(Membership.id)).where(
            Membership.firm_id == firm_id,
            Membership.client_id.is_(None),
            Membership.role == Role.firm_owner.value,
        )
    ) or 0


@router.get("")
async def list_members(
    principal: Principal = Depends(require_firm_role("firm_owner")),
    session: AsyncSession = Depends(get_session),
):
    firm_id = firm_id_of(principal)
    rows = await session.execute(
        select(User, Membership)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.firm_id == firm_id, Membership.client_id.is_(None))
        .order_by(User.email)
    )
    return [
        {
            "user_id": str(u.id),
            "email": u.email,
            "name": u.name,
            "role": m.role,
            "password_set": u.password_hash is not None,
        }
        for u, m in rows.all()
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_member(
    body: NewMember,
    principal: Principal = Depends(require_firm_role("firm_owner")),
    session: AsyncSession = Depends(get_session),
):
    """Create a firm staff member directly with name + login + password
    (without the invite link)."""
    if body.role not in FIRM_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid firm role")
    firm_id = firm_id_of(principal)
    email = body.email.strip()
    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "email is required")
    if await session.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")
    user = User(email=email, name=body.name, password_hash=hash_password(body.password))
    session.add(user)
    await session.flush()
    session.add(
        Membership(user_id=user.id, firm_id=firm_id, client_id=None, role=body.role)
    )
    return {"user_id": str(user.id), "email": email, "name": body.name}


@router.patch("/{user_id}")
async def patch_member(
    user_id: UUID,
    body: MemberPatch,
    principal: Principal = Depends(require_firm_role("firm_owner")),
    session: AsyncSession = Depends(get_session),
):
    """Update a firm staff member: role and/or profile (name/email) and password."""
    firm_id = firm_id_of(principal)
    m = await _firm_membership(session, firm_id, user_id)
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
    if body.role is not None:
        if body.role not in FIRM_ROLES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid firm role")
        if m.role == Role.firm_owner.value and body.role != Role.firm_owner.value:
            if await _owner_count(session, firm_id) <= 1:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot demote the last owner")
        m.role = body.role
    if body.name is not None or body.email is not None or body.password:
        user = await session.get(User, user_id)
        if body.name is not None:
            user.name = body.name
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


@router.delete("/{user_id}")
async def remove_member(
    user_id: UUID,
    principal: Principal = Depends(require_firm_role("firm_owner")),
    session: AsyncSession = Depends(get_session),
):
    firm_id = firm_id_of(principal)
    m = await _firm_membership(session, firm_id, user_id)
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
    if m.role == Role.firm_owner.value and await _owner_count(session, firm_id) <= 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot remove the last owner")
    await session.delete(m)
    return {"ok": True}


@router.get("/{user_id}/clients")
async def list_assigned_clients(
    user_id: UUID,
    principal: Principal = Depends(require_firm_role("firm_owner")),
    session: AsyncSession = Depends(get_session),
):
    """担当顧問先 (client_ids) a firm staff is assigned to."""
    firm_id = firm_id_of(principal)
    rows = await session.scalars(
        select(StaffClient.client_id).where(
            StaffClient.firm_id == firm_id, StaffClient.user_id == user_id
        )
    )
    return {"client_ids": [str(c) for c in rows]}


@router.put("/{user_id}/clients")
async def set_assigned_clients(
    user_id: UUID,
    body: AssignClients,
    principal: Principal = Depends(require_firm_role("firm_owner")),
    session: AsyncSession = Depends(get_session),
):
    """Replace a firm staff's 担当顧問先 assignments (firm_owner only)."""
    firm_id = firm_id_of(principal)
    member = await _firm_membership(session, firm_id, user_id)
    if not member:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")

    existing = list(
        await session.scalars(
            select(StaffClient).where(
                StaffClient.firm_id == firm_id, StaffClient.user_id == user_id
            )
        )
    )
    for row in existing:
        await session.delete(row)
    await session.flush()

    for cid in body.client_ids:
        client = await session.get(Client, cid)  # RLS: only this firm's clients
        if client and client.firm_id == firm_id:
            session.add(StaffClient(firm_id=firm_id, user_id=user_id, client_id=cid))
    return {"client_ids": [str(c) for c in body.client_ids]}
