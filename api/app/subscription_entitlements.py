"""ストアに依存しない subscription entitlement と firm plan の解決。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable
from uuid import UUID

from sqlalchemy import select

from . import plans
from .models import Firm, Subscription

_REVOKED_KEYWORDS = (
    "REVOKED",
    "EXPIRED",
    "REFUND",
    "VOIDED",
    "ON_HOLD",
    "PAUSED",
    "BILLING_RETRY",
)


def is_subscription_entitled(
    subscription: Subscription | object,
    *,
    now: datetime | None = None,
) -> bool:
    now = now or datetime.now(timezone.utc)
    if getattr(subscription, "revoked_at", None):
        return False
    state = str(getattr(subscription, "status", "") or "").upper()
    if any(keyword in state for keyword in _REVOKED_KEYWORDS):
        return False
    period_end = getattr(subscription, "current_period_end", None)
    return bool(period_end and period_end > now)


def choose_effective_subscription(
    subscriptions: Iterable[Subscription],
    *,
    now: datetime | None = None,
) -> Subscription | None:
    now = now or datetime.now(timezone.utc)
    entitled = [sub for sub in subscriptions if is_subscription_entitled(sub, now=now)]
    if not entitled:
        return None
    floor = datetime.min.replace(tzinfo=timezone.utc)
    return max(
        entitled,
        key=lambda sub: (
            getattr(sub, "current_period_end", None) or floor,
            getattr(sub, "created_at", None) or floor,
        ),
    )


def desired_plan_for_subscriptions(
    current_plan: str,
    subscriptions: Iterable[Subscription],
    *,
    now: datetime | None = None,
) -> str:
    if current_plan == plans.PLAN_BUSINESS:
        return plans.PLAN_BUSINESS
    return (
        plans.PLAN_PRO
        if choose_effective_subscription(subscriptions, now=now)
        else plans.PLAN_FREE
    )


async def subscriptions_for_firm(session, firm_id: UUID) -> list[Subscription]:
    return list(
        await session.scalars(
            select(Subscription).where(Subscription.firm_id == firm_id)
        )
    )


async def recompute_firm_plan(session, firm_id: UUID) -> Firm | None:
    # Google / Apple の同時更新でも、最後の再計算が全購読を見た状態で確定する。
    firm = await session.scalar(
        select(Firm).where(Firm.id == firm_id).with_for_update()
    )
    if not firm or firm.plan == plans.PLAN_BUSINESS:
        return firm
    subscriptions = await subscriptions_for_firm(session, firm_id)
    firm.plan = desired_plan_for_subscriptions(firm.plan, subscriptions)
    return firm
