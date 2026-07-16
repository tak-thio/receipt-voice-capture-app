"""Apple subscription の単発 reconciliation。scheduler には自動登録しない。"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Callable
from uuid import UUID

from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from . import billing
from .models import StoreNotificationEvent, Subscription
from .subscription_entitlements import recompute_firm_plan

_log = logging.getLogger("billing")


def apply_apple_subscription_result(
    subscription: Subscription,
    result: dict,
    *,
    verified_at: datetime,
) -> None:
    account_token = result.get("app_account_token")
    subscription.product_id = result["product_id"]
    subscription.status = "active" if result["active"] else result["state"]
    subscription.current_period_end = result.get("expiry")
    subscription.latest_transaction_id = result.get("transaction_id")
    subscription.store_environment = result.get("environment")
    if account_token:
        subscription.app_account_token = UUID(str(account_token))
    subscription.auto_renew_enabled = result.get("auto_renew_enabled")
    subscription.latest_store_signed_at = result.get("signed_at")
    subscription.last_verified_at = verified_at
    subscription.revoked_at = result.get("revoked_at")


async def reconcile_apple_subscriptions(
    session,
    *,
    verify_subscription: Callable = billing.verify_apple_subscription,
    product_id: str,
    limit: int = 100,
) -> dict[str, int]:
    """Apple subscriptions を最大 limit 件再照会する。1件の失敗で batch を止めない。"""
    subscriptions = list(
        await session.scalars(
            select(Subscription)
            .where(Subscription.platform == "apple")
            .order_by(Subscription.last_verified_at.asc().nullsfirst())
            .limit(max(1, min(limit, 1000)))
        )
    )
    stats = {"seen": len(subscriptions), "updated": 0, "failed": 0}

    for subscription in subscriptions:
        try:
            result = await run_in_threadpool(
                verify_subscription,
                signed_transaction_info=None,
                transaction_id=subscription.purchase_token,
                product_id=product_id,
            )
        except Exception:  # noqa: BLE001 — Apple API の個別失敗で batch を止めない
            stats["failed"] += 1
            _log.exception(
                "Apple subscription reconciliation verification failed subscription_id=%s",
                subscription.id,
            )
            continue
        if (
            result is None
            or result.get("authoritative") is not True
            or result.get("purchase_token") != subscription.purchase_token
        ):
            stats["failed"] += 1
            continue

        now = datetime.now(timezone.utc)
        apply_apple_subscription_result(subscription, result, verified_at=now)
        pending_events = list(
            await session.scalars(
                select(StoreNotificationEvent).where(
                    StoreNotificationEvent.platform == "apple",
                    StoreNotificationEvent.purchase_token
                    == subscription.purchase_token,
                    StoreNotificationEvent.status == "pending",
                )
            )
        )
        for event in pending_events:
            if (
                getattr(event, "purchase_token", None) != subscription.purchase_token
                or getattr(event, "status", None) != "pending"
            ):
                continue
            # App Store の最新状態を再照会済みなので、古い pending event は解決済みにできる。
            event.status = "reconciled"
            event.subscription_id = subscription.id
            event.processed_at = now
            event.last_error = None

        await recompute_firm_plan(session, subscription.firm_id)
        stats["updated"] += 1

    await session.flush()
    return stats
