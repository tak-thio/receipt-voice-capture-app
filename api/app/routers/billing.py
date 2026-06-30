"""アプリ内課金(IAP)の購入検証。アプリが購入トークンを送り、サーバが Play で検証して
有効なら firm.plan=pro を付与する。更新/解約のストア通知(RTDN)は別途(次フェーズ)。"""
from __future__ import annotations

import base64
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from .. import billing, metering, plans
from ..config import get_settings
from ..db import OwnerSessionLocal, get_session
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


# 解約済み(CANCELED)でも期限内なら維持。返金/失効/ホールド/一時停止は失効扱い。
_REVOKED_KEYWORDS = ("REVOKED", "EXPIRED", "ON_HOLD", "PAUSED")


def _entitled(result: dict) -> bool:
    """pro を維持すべきか。active(ACTIVE/猶予)なら維持。CANCELED でも期限内なら維持。
    返金/失効/ホールド/一時停止は失効。"""
    if result.get("active"):
        return True
    state = result.get("state") or ""
    if any(k in state for k in _REVOKED_KEYWORDS):
        return False
    exp = result.get("expiry")
    return bool(exp and exp > datetime.now(timezone.utc))


@router.post("/google/rtdn")
async def google_rtdn(request: Request, token: str = ""):
    """Google Play のリアルタイム開発者通知(RTDN)受信。Pub/Sub push が JSON を POST する。
    更新/解約/返金/失効を Play に再問い合わせして subscriptions と firm.plan に反映する。
    認証は URL の ?token=(play_rtdn_secret)。付与は通知を信用せず必ず Play で再検証する。
    テナント主体が無いので owner 接続(RLSバイパス)で purchase_token から firm を引いて更新する。"""
    if not settings.play_rtdn_secret or token != settings.play_rtdn_secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")
    try:
        envelope = await request.json()
    except Exception:
        return {"ok": True}  # 解釈不能は ack(再送ループ回避)
    data_b64 = ((envelope or {}).get("message") or {}).get("data")
    if not data_b64:
        return {"ok": True}
    try:
        notif = json.loads(base64.b64decode(data_b64).decode())
    except Exception:
        return {"ok": True}
    if "testNotification" in notif:  # RTDN 設定時に Play が送る疎通確認
        return {"ok": True, "test": True}

    sub_n = notif.get("subscriptionNotification")
    voided = notif.get("voidedPurchaseNotification")
    purchase_token = (sub_n or voided or {}).get("purchaseToken")
    if not purchase_token:
        return {"ok": True}  # oneTimeProduct 等は対象外

    result = None
    if sub_n:
        product_id = sub_n.get("subscriptionId") or settings.play_pro_product_id
        result = await run_in_threadpool(billing.verify_google_subscription, purchase_token, product_id)
        if result is None:
            # Play 取得失敗(一時的/未設定)。ack せず再送させる。
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "verify unavailable")

    async with OwnerSessionLocal() as session:  # クロステナント。id で明示スコープ。
        async with session.begin():
            sub = await session.scalar(
                select(Subscription).where(Subscription.purchase_token == purchase_token)
            )
            if not sub:
                return {"ok": True}  # 未知トークン(初回検証前など)。何もしない。
            firm = await session.get(Firm, sub.firm_id)
            if voided:
                sub.status = "voided"
                if firm and firm.plan == plans.PLAN_PRO:
                    firm.plan = plans.PLAN_FREE  # 返金/チャージバックは即失効
                return {"ok": True}
            sub.status = "active" if result["active"] else result["state"]
            sub.current_period_end = result["expiry"]
            if firm:
                if _entitled(result):
                    if firm.plan != plans.PLAN_BUSINESS:
                        firm.plan = plans.PLAN_PRO
                elif firm.plan == plans.PLAN_PRO:
                    firm.plan = plans.PLAN_FREE
    return {"ok": True}
