"""顧問先 (client) management within a firm."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import Principal, get_principal, require_firm_role
from ..models import Client

router = APIRouter(prefix="/clients", tags=["clients"])


class ClientIn(BaseModel):
    name: str
    code: str | None = None
    export_default: str = "generic"


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
