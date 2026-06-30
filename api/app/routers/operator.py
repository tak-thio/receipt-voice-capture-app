"""Platform operator (運営) endpoints: provision and manage 税理士事務所 (firms).

This is the layer ABOVE firm_owner. An operator authenticates with its own
`op_session` cookie (separate from tenant users) and can:
  - create a new firm together with its first firm_owner,
  - list firms with management metadata (name / plan / status / owners),
  - update a firm (rename, change plan, suspend / reactivate).

It deliberately CANNOT read any tenant's receipt/client data: operator requests
run with app_uid() = NULL, which the RLS policies expose only on the identity
tables (firms/users/memberships), never on tenant data tables. See deps.get_operator.
"""

from collections import defaultdict
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import plans
from ..config import get_settings
from ..db import get_session, set_rls_context
from ..deps import OperatorPrincipal, get_operator
from ..models import Firm, Membership, Operator, Role, User
from ..security import hash_password, make_operator_session, verify_password
from ..seed import seed_firm_template

router = APIRouter(prefix="/operator", tags=["operator"])
settings = get_settings()

VALID_STATUS = {"active", "suspended"}


# --- auth ------------------------------------------------------------------

class OperatorLogin(BaseModel):
    email: str
    password: str


def _set_op_cookie(response: Response, operator_id: str) -> None:
    response.set_cookie(
        "op_session",
        make_operator_session(operator_id),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=60 * 60 * 24 * 14,
    )


@router.post("/login")
async def operator_login(
    body: OperatorLogin, response: Response, session: AsyncSession = Depends(get_session)
):
    operator = await session.scalar(select(Operator).where(Operator.email == body.email))
    if not operator or not verify_password(body.password, operator.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")
    if operator.status != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "operator disabled")
    operator.last_login_at = datetime.now(timezone.utc)
    _set_op_cookie(response, str(operator.id))
    return {"operator_id": str(operator.id)}


@router.post("/logout")
async def operator_logout(response: Response):
    response.delete_cookie("op_session")
    return {"ok": True}


@router.get("/me")
async def operator_me(principal: OperatorPrincipal = Depends(get_operator)):
    op = principal.operator
    return {"id": str(op.id), "email": op.email, "name": op.name, "status": op.status}


# --- firm (税理士事務所) provisioning & management -------------------------

class CreateFirm(BaseModel):
    firm_name: str
    owner_email: str
    owner_password: str
    owner_name: str = ""
    plan: str = "business"  # operator が作るのは会社(B2B)=business(枚数無制限)。個人サインアップは free。


@router.post("/firms", status_code=status.HTTP_201_CREATED)
async def create_firm(
    body: CreateFirm,
    _: OperatorPrincipal = Depends(get_operator),
    session: AsyncSession = Depends(get_session),
):
    """Provision a new firm with its first owner. Replaces the old public
    /auth/register-firm — now only an authenticated operator can create firms."""
    exists = await session.scalar(select(User).where(User.email == body.owner_email))
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "owner email already registered")

    firm = Firm(name=body.firm_name, plan=body.plan)
    owner = User(
        email=body.owner_email,
        name=body.owner_name,
        password_hash=hash_password(body.owner_password),
    )
    session.add_all([firm, owner])
    await session.flush()
    session.add(
        Membership(user_id=owner.id, firm_id=firm.id, client_id=None, role=Role.firm_owner.value)
    )
    await session.flush()

    # Bind RLS to the new owner so the template insert passes WITH CHECK, then
    # seed the firm's default account-title template (client_id = NULL).
    await set_rls_context(session, owner.id)
    await seed_firm_template(session, firm.id)

    return {"firm_id": str(firm.id), "owner_user_id": str(owner.id)}


@router.get("/firms")
async def list_firms(
    kind: str = Query("firm"),  # firm=会計事務所(business) / individual=個人(free,pro) / all=全件
    _: OperatorPrincipal = Depends(get_operator),
    session: AsyncSession = Depends(get_session),
):
    """Management list of firms (metadata + owner emails only — NOT firm data).
    kind で会計事務所(business)と個人(free/pro)を分けて返す(既定=事務所のみ)。"""
    stmt = select(Firm).order_by(Firm.created_at)
    if kind == "firm":
        stmt = stmt.where(Firm.plan == plans.PLAN_BUSINESS)
    elif kind == "individual":
        stmt = stmt.where(Firm.plan.in_([plans.PLAN_FREE, plans.PLAN_PRO]))
    firms = (await session.scalars(stmt)).all()
    owner_rows = await session.execute(
        select(Membership.firm_id, User.email)
        .join(User, User.id == Membership.user_id)
        .where(Membership.client_id.is_(None), Membership.role == Role.firm_owner.value)
    )
    owners: dict[UUID, list[str]] = defaultdict(list)
    for firm_id, email in owner_rows.all():
        owners[firm_id].append(email)
    return [
        {
            "id": str(f.id),
            "name": f.name,
            "plan": f.plan,
            "status": f.status,
            "created_at": f.created_at.isoformat() if f.created_at else None,
            "owners": owners.get(f.id, []),
        }
        for f in firms
    ]


class FirmUpdate(BaseModel):
    name: str | None = None
    plan: str | None = None
    status: str | None = None  # active | suspended


@router.patch("/firms/{firm_id}")
async def update_firm(
    firm_id: UUID,
    body: FirmUpdate,
    _: OperatorPrincipal = Depends(get_operator),
    session: AsyncSession = Depends(get_session),
):
    firm = await session.get(Firm, firm_id)
    if not firm:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "firm not found")
    if body.name is not None:
        firm.name = body.name
    if body.plan is not None:
        firm.plan = body.plan
    if body.status is not None:
        if body.status not in VALID_STATUS:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"status must be one of {sorted(VALID_STATUS)}")
        firm.status = body.status
    return {"id": str(firm.id), "name": firm.name, "plan": firm.plan, "status": firm.status}
