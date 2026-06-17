from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_session
from ..deps import Principal, get_principal
from ..models import Client, Firm, Membership, User
from ..security import make_session, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

# NOTE: firms are no longer created here. Creating a 税理士事務所 is a platform
# operator action — see routers/operator.py (POST /operator/firms). The old
# public /auth/register-firm has been removed so that firms can only be
# provisioned by an authenticated operator.


class Login(BaseModel):
    email: str
    password: str


def _set_cookie(response: Response, user_id: str) -> None:
    response.set_cookie(
        "rs_session",
        make_session(user_id),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=60 * 60 * 24 * 14,
    )


@router.post("/login")
async def login(body: Login, response: Response, session: AsyncSession = Depends(get_session)):
    user = await session.scalar(select(User).where(User.email == body.email))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")
    if user.status == "disabled":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "account disabled")

    # Block login when every firm the user belongs to is suspended by an operator.
    # (Pre-auth, so app_uid() is NULL and the RLS NULL-escape allows these reads.)
    firm_ids = (
        await session.scalars(select(Membership.firm_id).where(Membership.user_id == user.id))
    ).all()
    if firm_ids:
        active = await session.scalar(
            select(func.count())
            .select_from(Firm)
            .where(Firm.id.in_(firm_ids), Firm.status == "active")
        )
        if not active:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "firm suspended")

    _set_cookie(response, str(user.id))
    return {"user_id": str(user.id)}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("rs_session")
    return {"ok": True}


@router.get("/me")
async def me(
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    # サイドバーのサブタイトルに出す「自分の組織名」: 事務所メンバー(firm_owner/staff)は
    # 事務所名、顧問先メンバーは自社(顧問先)名。RLS で自分の所属だけ読める。
    firm_m = next((m for m in principal.memberships if m.client_id is None), None)
    org_name = None
    if firm_m:
        firm = await session.get(Firm, firm_m.firm_id)
        org_name = firm.name if firm else None
    else:
        client_m = next((m for m in principal.memberships if m.client_id is not None), None)
        if client_m:
            client = await session.get(Client, client_m.client_id)
            org_name = client.name if client else None
    return {
        "user": {"id": str(principal.user.id), "email": principal.user.email, "name": principal.user.name},
        "memberships": [
            {
                "firm_id": str(m.firm_id),
                "client_id": str(m.client_id) if m.client_id else None,
                "role": m.role,
            }
            for m in principal.memberships
        ],
        "org_name": org_name,
        "device_client_id": str(principal.device_client_id) if principal.device_client_id else None,
    }
