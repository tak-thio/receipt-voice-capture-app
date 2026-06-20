"""アプリ内課金(IAP)の購入検証。アプリが購入トークンを送り、サーバが Play で検証して
有効なら firm.plan=pro を付与する。更新/解約のストア通知(RTDN)は別途(次フェーズ)。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from .. import billing, metering, plans
from ..config import get_settings
from ..db import get_session
from ..deps import Principal, get_principal
from ..models import Firm, Subscription

router = APIRouter(prefix="/billing", tags=["billing"])
settings = get_settings()


class VerifyBody(BaseModel):
    purchase_token: str
    product_id: str | None = None


@router.post("/google/verify")
async def google_verify(
    body: VerifyBody,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """Google Play の購入トークンを検証し、有効なら pro を付与。アプリが購入直後に呼ぶ。"""
    firm_id = principal.memberships[0].firm_id if principal.memberships else None
    if not firm_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "アカウントがありません")
    product_id = body.product_id or settings.play_pro_product_id
    result = await run_in_threadpool(billing.verify_google_subscription, body.purchase_token, product_id)
    if result is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "課金が未設定、または検証に失敗しました")

    new_status = "active" if result["active"] else result["state"]
    sub = await session.scalar(select(Subscription).where(Subscription.purchase_token == body.purchase_token))
    if sub:
        sub.firm_id = firm_id
        sub.product_id = result["product_id"]
        sub.status = new_status
        sub.current_period_end = result["expiry"]
    else:
        session.add(
            Subscription(
                firm_id=firm_id, platform="google", product_id=result["product_id"],
                purchase_token=body.purchase_token, status=new_status, current_period_end=result["expiry"],
            )
        )
    firm = await session.get(Firm, firm_id)
    if firm and result["active"] and firm.plan != plans.PLAN_BUSINESS:
        firm.plan = plans.PLAN_PRO  # 有効な購入で pro に昇格(business は据え置き)
    await session.flush()
    plan = firm.plan if firm else None
    return {
        "plan": plan,
        "active": result["active"],
        "used": await metering.monthly_usage(session, firm_id),
        "cap": plans.monthly_cap(plan),
    }
