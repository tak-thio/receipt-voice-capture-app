"""顧問先 (client) management within a firm, plus its users."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import Principal, can_admin_client, get_principal, require_firm_role
from ..models import Client, Membership, Role, User

router = APIRouter(prefix="/clients", tags=["clients"])

CLIENT_ROLES = {Role.client_admin.value, Role.client_user.value}


class ClientIn(BaseModel):
    name: str
    code: str | None = None
    export_default: str = "generic"


class RolePatch(BaseModel):
    role: str


def _guard_client(principal: Principal, client_id: UUID) -> None:
    if not can_admin_client(principal, client_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "cannot manage this client")


@router.get("")
async def list_clients(
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    rows = await session.scalars(select(Client).order_by(Client.name))
    return [
        {"id": str(c.id), "name": c.name, "code": c.code, "export_default": c.export_default}
        for c in rows
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_client(
    body: ClientIn,
    principal: Principal = Depends(require_firm_role()),
    session: AsyncSession = Depends(get_session),
):
    firm_membership = next((m for m in principal.memberships if m.client_id is None), None)
    if not firm_membership:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no firm-level membership")
    client = Client(
        firm_id=firm_membership.firm_id,
        name=body.name,
        code=body.code,
        export_default=body.export_default,
    )
    session.add(client)
    await session.flush()
    # No template copy needed: a client inherits the firm's account-title
    # template (client_id NULL) via the overlay in the masters router, and only
    # adds rows to override/extend it.
    return {"id": str(client.id)}


@router.get("/{client_id}/users")
async def list_client_users(
    client_id: UUID,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    _guard_client(principal, client_id)
    rows = await session.execute(
        select(User, Membership)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.client_id == client_id)
        .order_by(User.email)
    )
    return [
        {"user_id": str(u.id), "email": u.email, "name": u.name, "role": m.role}
        for u, m in rows.all()
    ]


@router.patch("/{client_id}/users/{user_id}")
async def set_client_user_role(
    client_id: UUID,
    user_id: UUID,
    body: RolePatch,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    _guard_client(principal, client_id)
    if body.role not in CLIENT_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid client role")
    m = await session.scalar(
        select(Membership).where(
            Membership.client_id == client_id, Membership.user_id == user_id
        )
    )
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client user not found")
    m.role = body.role
    return {"ok": True}


@router.delete("/{client_id}/users/{user_id}")
async def remove_client_user(
    client_id: UUID,
    user_id: UUID,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    _guard_client(principal, client_id)
    m = await session.scalar(
        select(Membership).where(
            Membership.client_id == client_id, Membership.user_id == user_id
        )
    )
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client user not found")
    await session.delete(m)
    return {"ok": True}
