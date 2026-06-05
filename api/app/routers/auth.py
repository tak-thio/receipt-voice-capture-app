from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_session, set_rls_context
from ..deps import Principal, get_principal
from ..models import Firm, Membership, Role, User
from ..security import hash_password, make_session, verify_password
from ..seed import seed_firm_template

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


class RegisterFirm(BaseModel):
    firm_name: str
    email: str  # TODO: EmailStr once pydantic[email] is added to requirements
    password: str
    name: str = ""


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


@router.post("/register-firm", status_code=status.HTTP_201_CREATED)
async def register_firm(
    body: RegisterFirm, response: Response, session: AsyncSession = Depends(get_session)
):
    """Bootstrap: create a firm with its first owner user."""
    exists = await session.scalar(select(User).where(User.email == body.email))
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")

    firm = Firm(name=body.firm_name)
    user = User(email=body.email, name=body.name, password_hash=hash_password(body.password))
    session.add_all([firm, user])
    await session.flush()
    session.add(
        Membership(user_id=user.id, firm_id=firm.id, client_id=None, role=Role.firm_owner.value)
    )
    await session.flush()

    # Bind RLS to the new owner so the template insert passes WITH CHECK, then
    # seed the firm's default account-title template (client_id = NULL).
    await set_rls_context(session, user.id)
    await seed_firm_template(session, firm.id)

    _set_cookie(response, str(user.id))
    return {"firm_id": str(firm.id), "user_id": str(user.id)}


@router.post("/login")
async def login(body: Login, response: Response, session: AsyncSession = Depends(get_session)):
    user = await session.scalar(select(User).where(User.email == body.email))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")
    if user.status == "disabled":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "account disabled")
    _set_cookie(response, str(user.id))
    return {"user_id": str(user.id)}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("rs_session")
    return {"ok": True}


@router.get("/me")
async def me(principal: Principal = Depends(get_principal)):
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
        "device_client_id": str(principal.device_client_id) if principal.device_client_id else None,
    }
