"""Invitations: onboard firm staff / client users via a shareable link.

An admin creates an invite (role + optional client) and shares the link; the
invitee opens it and sets their own email + password. No email delivery needed.
Looked up by token at redeem (unauthenticated), like pairing.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_session
from ..deps import Principal, can_admin_client, firm_id_of, get_principal, is_firm_owner
from ..models import Client, Invite, Membership, Role, User
from ..security import hash_password, hash_token, make_session, new_token

router = APIRouter(prefix="/invites", tags=["invites"])
settings = get_settings()

FIRM_ROLES = {Role.firm_owner.value, Role.firm_staff.value}
CLIENT_ROLES = {Role.client_admin.value, Role.client_user.value}


class InviteIn(BaseModel):
    role: str
    client_id: UUID | None = None
    email: str | None = None
    expires_hours: int = 72


class RedeemIn(BaseModel):
    token: str
    email: str
    password: str
    name: str = ""


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_invite(
    body: InviteIn,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    firm_id = firm_id_of(principal)
    if not firm_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no firm membership")

    if body.role in FIRM_ROLES:
        if body.client_id is not None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "firm role takes no client_id")
        if not is_firm_owner(principal):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "firm_owner required")
    elif body.role in CLIENT_ROLES:
        if body.client_id is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "client role needs client_id")
        if not can_admin_client(principal, body.client_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "cannot manage this client")
        if not await session.get(Client, body.client_id):  # RLS-scoped existence check
            raise HTTPException(status.HTTP_404_NOT_FOUND, "client not found")
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid role")

    token = new_token()
    session.add(
        Invite(
            firm_id=firm_id,
            client_id=body.client_id,
            role=body.role,
            email=body.email,
            token_hash=hash_token(token),
            expires_at=datetime.now(timezone.utc) + timedelta(hours=body.expires_hours),
            created_by=principal.user.id,
        )
    )
    return {"token": token, "redeem_path": f"/invite?token={token}"}


@router.get("")
async def list_invites(
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    firm_id = firm_id_of(principal)
    rows = await session.scalars(
        select(Invite).where(
            Invite.firm_id == firm_id, Invite.used_at.is_(None)
        ).order_by(Invite.created_at.desc())
    )
    return [
        {
            "id": str(i.id),
            "role": i.role,
            "client_id": str(i.client_id) if i.client_id else None,
            "email": i.email,
            "expires_at": i.expires_at.isoformat(),
        }
        for i in rows
    ]


@router.delete("/{invite_id}")
async def revoke_invite(
    invite_id: UUID,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    invite = await session.get(Invite, invite_id)
    if not invite or invite.firm_id != firm_id_of(principal):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invite not found")
    invite.used_at = datetime.now(timezone.utc)
    return {"ok": True}


@router.post("/redeem")
async def redeem_invite(
    body: RedeemIn, response: Response, session: AsyncSession = Depends(get_session)
):
    invite = await session.scalar(
        select(Invite).where(Invite.token_hash == hash_token(body.token))
    )
    if not invite or invite.used_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid invite")
    if invite.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invite expired")
    if invite.email and invite.email.lower() != body.email.lower():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "email does not match the invite")

    if await session.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")

    user = User(email=body.email, name=body.name, password_hash=hash_password(body.password))
    session.add(user)
    await session.flush()
    session.add(
        Membership(
            user_id=user.id,
            firm_id=invite.firm_id,
            client_id=invite.client_id,
            role=invite.role,
        )
    )
    invite.used_at = datetime.now(timezone.utc)

    response.set_cookie(
        "rs_session",
        make_session(str(user.id)),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=60 * 60 * 24 * 14,
    )
    return {"user_id": str(user.id), "firm_id": str(invite.firm_id), "role": invite.role}
