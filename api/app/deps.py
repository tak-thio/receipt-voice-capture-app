"""Request dependencies: resolve the principal and bind RLS context.

A request authenticates either as a web user (signed session cookie) or a
paired mobile device (Bearer device token). Either way we resolve the User and
call set_rls_context so the database enforces tenant isolation.
"""

from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_session, set_rls_context
from .models import DeviceSession, Membership, Role, User
from .security import hash_token, read_session


@dataclass
class Principal:
    user: User
    memberships: list[Membership]
    # For mobile device sessions, the client the device is paired to.
    device_client_id: UUID | None = None


async def _resolve_user_id(request: Request, authorization: str | None, session: AsyncSession):
    # 1) Mobile device: Authorization: Bearer <device-token>
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        row = await session.scalar(
            select(DeviceSession).where(
                DeviceSession.refresh_token_hash == hash_token(token),
                DeviceSession.revoked_at.is_(None),
            )
        )
        if row:
            return row.user_id, row.client_id

    # 2) Web: signed session cookie.
    cookie = request.cookies.get("rs_session")
    if cookie:
        uid = read_session(cookie)
        if uid:
            return UUID(uid), None

    return None, None


async def get_principal(
    request: Request,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> Principal:
    user_id, device_client_id = await _resolve_user_id(request, authorization, session)
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")

    # Bind RLS for the rest of this transaction BEFORE touching tenant data.
    await set_rls_context(session, user_id)

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown user")
    if user.status == "disabled":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "account disabled")

    memberships = list(
        await session.scalars(select(Membership).where(Membership.user_id == user_id))
    )
    return Principal(user=user, memberships=memberships, device_client_id=device_client_id)


def require_firm_role(*roles: str):
    """Guard a route to firm-level roles (firm_owner / firm_staff)."""

    async def _dep(principal: Principal = Depends(get_principal)) -> Principal:
        allowed = roles or ("firm_owner", "firm_staff")
        if not any(m.role in allowed for m in principal.memberships):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
        return principal

    return _dep


# --- tenancy/role helpers --------------------------------------------------

def firm_id_of(principal: Principal) -> UUID | None:
    """The firm the principal acts in (firm-level membership preferred)."""
    firm = next((m for m in principal.memberships if m.client_id is None), None)
    if firm:
        return firm.firm_id
    return principal.memberships[0].firm_id if principal.memberships else None


def is_firm_owner(principal: Principal) -> bool:
    return any(
        m.client_id is None and m.role == Role.firm_owner.value for m in principal.memberships
    )


def is_firm_staff(principal: Principal) -> bool:
    return any(
        m.client_id is None and m.role in (Role.firm_owner.value, Role.firm_staff.value)
        for m in principal.memberships
    )


def can_admin_client(principal: Principal, client_id: UUID) -> bool:
    """Firm staff (any client) or the client's own admin."""
    if is_firm_staff(principal):
        return True
    return any(
        m.client_id == client_id and m.role == Role.client_admin.value
        for m in principal.memberships
    )
