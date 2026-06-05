"""Firm staff (firm-level memberships) management."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import Principal, firm_id_of, get_principal, require_firm_role
from ..models import Membership, Role, User

router = APIRouter(prefix="/members", tags=["members"])

FIRM_ROLES = {Role.firm_owner.value, Role.firm_staff.value}


class RolePatch(BaseModel):
    role: str


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
    principal: Principal = Depends(require_firm_role()),
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
        {"user_id": str(u.id), "email": u.email, "name": u.name, "role": m.role}
        for u, m in rows.all()
    ]


@router.patch("/{user_id}")
async def set_role(
    user_id: UUID,
    body: RolePatch,
    principal: Principal = Depends(require_firm_role("firm_owner")),
    session: AsyncSession = Depends(get_session),
):
    if body.role not in FIRM_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid firm role")
    firm_id = firm_id_of(principal)
    m = await _firm_membership(session, firm_id, user_id)
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
    if m.role == Role.firm_owner.value and body.role != Role.firm_owner.value:
        if await _owner_count(session, firm_id) <= 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot demote the last owner")
    m.role = body.role
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
