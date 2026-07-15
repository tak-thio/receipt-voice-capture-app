"""アプリ内課金(IAP)の購入検証。アプリが購入トークンを送り、サーバが Play で検証して
有効なら firm.plan=pro を付与する。更新/解約のストア通知(RTDN)は別途(次フェーズ)。"""
from __future__ import annotations

import base64
import hashlib
import json
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from .. import billing, metering, plans
from ..config import get_settings
from ..db import OwnerSessionLocal, get_session
from ..deps import Principal, get_principal
from ..models import Firm, StoreNotificationEvent, Subscription
from ..subscription_entitlements import (
    choose_effective_subscription,
    is_subscription_entitled,
    recompute_firm_plan,
)

router = APIRouter(prefix="/billing", tags=["billing"])
settings = get_settings()


class VerifyBody(BaseModel):
    purchase_token: str
    product_id: str | None = None


class AppleVerifyBody(BaseModel):
    signed_transaction_info: str | None = None
    transaction_id: str | None = None
    original_transaction_id: str | None = None
    product_id: str | None = None

    @model_validator(mode="after")
    def validate_transaction_source(self):
        if not (self.signed_transaction_info or self.transaction_id):
            raise ValueError("署名済み取引情報または取引IDが必要です")
        if self.product_id and self.product_id != settings.apple_pro_product_id:
            raise ValueError("対象外の商品です")
        return self


class AppleNotificationBody(BaseModel):
    signedPayload: str


@router.get("/apple/purchase-context")
async def apple_purchase_context(
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """現在の firm 専用の StoreKit appAccountToken を返す。"""
    firm_id = principal.memberships[0].firm_id if principal.memberships else None
    if not firm_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "アカウントがありません")
    # 同一 firm から同時要求されても異なる token を返さないよう行ロックする。
    firm = await session.scalar(
        select(Firm).where(Firm.id == firm_id).with_for_update()
    )
    if not firm:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "アカウントが見つかりません")
    if not firm.billing_account_token:
        firm.billing_account_token = uuid4()
        await session.flush()
    return {"appAccountToken": str(firm.billing_account_token)}


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


@router.post("/apple/verify")
async def apple_verify(
    body: AppleVerifyBody,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """App Store の取引を検証し、有効なら pro を付与する。"""
    firm_id = principal.memberships[0].firm_id if principal.memberships else None
    if not firm_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "アカウントがありません")

    product_id = settings.apple_pro_product_id
    result = await run_in_threadpool(
        billing.verify_apple_subscription,
        signed_transaction_info=body.signed_transaction_info,
        transaction_id=body.transaction_id,
        product_id=product_id,
    )
    if result is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "課金が未設定、または検証に失敗しました")

    firm = await session.get(Firm, firm_id)
    signed_account_token = result.get("app_account_token")
    if signed_account_token:
        try:
            signed_account_uuid = UUID(str(signed_account_token))
        except ValueError as exc:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "購入情報のアカウント識別子が不正です"
            ) from exc
        if not firm or firm.billing_account_token != signed_account_uuid:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "この購入は現在のアカウントに紐づいていません",
            )

    new_status = "active" if result["active"] else result["state"]
    sub = await session.scalar(
        select(Subscription).where(
            Subscription.firm_id == firm_id,
            Subscription.platform == "apple",
            Subscription.purchase_token == result["purchase_token"],
        )
    )
    if sub:
        sub.product_id = result["product_id"]
        sub.status = new_status
        sub.current_period_end = result["expiry"]
        sub.latest_transaction_id = result.get("transaction_id")
        sub.store_environment = result.get("environment")
        if signed_account_token:
            sub.app_account_token = UUID(str(signed_account_token))
        sub.auto_renew_enabled = result.get("auto_renew_enabled")
        sub.latest_store_signed_at = result.get("signed_at")
        sub.last_verified_at = datetime.now(timezone.utc)
        sub.revoked_at = result.get("revoked_at")
    else:
        session.add(
            Subscription(
                firm_id=firm_id,
                platform="apple",
                product_id=result["product_id"],
                purchase_token=result["purchase_token"],
                status=new_status,
                current_period_end=result["expiry"],
                latest_transaction_id=result.get("transaction_id"),
                store_environment=result.get("environment"),
                app_account_token=(
                    UUID(str(signed_account_token)) if signed_account_token else None
                ),
                auto_renew_enabled=result.get("auto_renew_enabled"),
                latest_store_signed_at=result.get("signed_at"),
                last_verified_at=datetime.now(timezone.utc),
                revoked_at=result.get("revoked_at"),
            )
        )

    if firm and result["active"] and firm.plan != plans.PLAN_BUSINESS:
        firm.plan = plans.PLAN_PRO
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "この購入は別のアカウントに紐づいています",
        ) from exc
    plan = firm.plan if firm else None
    return {
        "plan": plan,
        "active": result["active"],
        "used": await metering.monthly_usage(session, firm_id),
        "cap": plans.monthly_cap(plan),
    }


async def _process_apple_notification(
    body: AppleNotificationBody,
    expected_environment: str | None,
):
    result = await run_in_threadpool(
        billing.verify_apple_notification,
        signed_payload=body.signedPayload,
        product_id=settings.apple_pro_product_id,
        expected_environment=expected_environment,
    )
    if result is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "verify unavailable")
    actual_environment = result.get("environment")
    if (
        expected_environment
        and actual_environment
        and actual_environment != expected_environment
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "通知の App Store 環境が URL と一致しません",
        )
    if result["test"]:
        return {"ok": True, "test": True}

    async with OwnerSessionLocal() as session:
        async with session.begin():
            notification_uuid = result.get("notification_uuid") or hashlib.sha256(
                body.signedPayload.encode()
            ).hexdigest()
            existing_event = await session.scalar(
                select(StoreNotificationEvent).where(
                    StoreNotificationEvent.notification_uuid == notification_uuid
                )
            )
            if existing_event:
                existing_event.attempts = (existing_event.attempts or 0) + 1
                return {"ok": True, "duplicate": True}

            event = StoreNotificationEvent(
                platform="apple",
                environment=actual_environment or expected_environment,
                notification_uuid=notification_uuid,
                purchase_token=result.get("purchase_token"),
                signed_payload=body.signedPayload,
                signed_at=result.get("signed_at"),
                status="received",
                attempts=1,
            )
            session.add(event)
            try:
                await session.flush()
            except IntegrityError:
                # 同じ UUID が同時到着した場合も Apple には成功として ack する。
                await session.rollback()
                return {"ok": True, "duplicate": True}
            sub = await session.scalar(
                select(Subscription).where(
                    Subscription.platform == "apple",
                    Subscription.purchase_token == result["purchase_token"],
                )
            )
            if not sub:
                event.status = "pending"
                return {"ok": True}

            event.subscription_id = getattr(sub, "id", None)
            current_signed_at = getattr(sub, "latest_store_signed_at", None)
            incoming_signed_at = result.get("signed_at")
            if current_signed_at and incoming_signed_at and incoming_signed_at < current_signed_at:
                event.status = "ignored_stale"
                event.processed_at = datetime.now(timezone.utc)
                return {"ok": True}

            if (
                sub.current_period_end
                and result["expiry"]
                and result["expiry"] < sub.current_period_end
            ):
                event.status = "ignored_stale"
                event.processed_at = datetime.now(timezone.utc)
                return {"ok": True}

            sub.status = result["state"]
            sub.current_period_end = result["expiry"]
            sub.latest_transaction_id = result.get("transaction_id")
            sub.store_environment = actual_environment
            account_token = result.get("app_account_token")
            sub.app_account_token = UUID(str(account_token)) if account_token else getattr(
                sub, "app_account_token", None
            )
            sub.auto_renew_enabled = result.get("auto_renew_enabled")
            sub.latest_store_signed_at = incoming_signed_at
            sub.last_verified_at = datetime.now(timezone.utc)
            sub.revoked_at = result.get("revoked_at")
            await recompute_firm_plan(session, sub.firm_id)
            event.status = "processed"
            event.processed_at = datetime.now(timezone.utc)
    return {"ok": True}


@router.post("/apple/notifications")
async def apple_notifications(body: AppleNotificationBody):
    """既存設定向け互換入口。環境は payload／server 設定から検証する。"""
    return await _process_apple_notification(body, None)


@router.post("/apple/notifications/{environment}")
async def apple_notifications_for_environment(
    environment: str,
    body: AppleNotificationBody,
):
    """Sandbox／Production を URL でも分離した ASSN V2 入口。"""
    normalized = environment.strip().lower()
    if normalized not in {"sandbox", "production"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "未対応の App Store 環境です")
    return await _process_apple_notification(body, normalized)


def _subscription_is_active(sub: Subscription) -> bool:
    return is_subscription_entitled(sub)


@router.get("/subscription")
async def billing_subscription(
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """現在の firm に紐づく最新のストア購読状態を返す。"""
    firm_id = principal.memberships[0].firm_id if principal.memberships else None
    if not firm_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "アカウントがありません")

    subscriptions = list(await session.scalars(
        select(Subscription)
        .where(Subscription.firm_id == firm_id)
        .order_by(
            Subscription.current_period_end.desc().nullslast(),
            Subscription.created_at.desc(),
        )
    ))
    # 有効な別 platform があればそれを優先する。全て失効済みなら従来どおり最新行を返す。
    sub = choose_effective_subscription(subscriptions) or (
        subscriptions[0] if subscriptions else None
    )
    if not sub:
        return {
            "active": False,
            "platform": None,
            "productId": None,
            "currentPeriodEnd": None,
        }
    return {
        "active": _subscription_is_active(sub),
        "platform": sub.platform,
        "productId": sub.product_id,
        "currentPeriodEnd": (
            sub.current_period_end.isoformat() if sub.current_period_end else None
        ),
    }


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
            if voided:
                sub.status = "voided"
                await recompute_firm_plan(session, sub.firm_id)
                return {"ok": True}
            sub.status = "active" if result["active"] else result["state"]
            sub.current_period_end = result["expiry"]
            await recompute_firm_plan(session, sub.firm_id)
    return {"ok": True}
