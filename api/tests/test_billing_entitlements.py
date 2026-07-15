from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest

from app import plans
from app.models import Firm, StoreNotificationEvent, Subscription
from app.subscription_entitlements import (
    choose_effective_subscription,
    desired_plan_for_subscriptions,
    is_subscription_entitled,
)


class SubscriptionPersistenceTest(unittest.TestCase):
    def test_apple_resilience_columns_are_mapped(self):
        self.assertIn("billing_account_token", Firm.__table__.columns)
        for column in (
            "latest_transaction_id",
            "store_environment",
            "app_account_token",
            "auto_renew_enabled",
            "latest_store_signed_at",
            "last_verified_at",
            "revoked_at",
        ):
            self.assertIn(column, Subscription.__table__.columns)

    def test_notification_uuid_is_unique(self):
        constraints = StoreNotificationEvent.__table__.constraints
        unique_columns = {
            tuple(column.name for column in constraint.columns)
            for constraint in constraints
            if constraint.__class__.__name__ == "UniqueConstraint"
        }
        self.assertIn(("notification_uuid",), unique_columns)


class SubscriptionEntitlementTest(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc).replace(microsecond=0)

    def sub(self, *, platform="apple", status="active", days=10):
        return SimpleNamespace(
            platform=platform,
            status=status,
            current_period_end=self.now + timedelta(days=days),
            revoked_at=None,
            created_at=self.now,
        )

    def test_active_and_canceled_until_expiry_are_entitled(self):
        self.assertTrue(is_subscription_entitled(self.sub(), now=self.now))
        self.assertTrue(
            is_subscription_entitled(
                self.sub(status="canceled_until_expiry"), now=self.now
            )
        )

    def test_revoked_and_expired_are_not_entitled(self):
        self.assertFalse(
            is_subscription_entitled(self.sub(status="revoked"), now=self.now)
        )
        self.assertFalse(
            is_subscription_entitled(self.sub(status="expired"), now=self.now)
        )

    def test_any_active_platform_keeps_pro(self):
        apple = self.sub(platform="apple", status="expired", days=-1)
        google = self.sub(platform="google", status="active", days=4)

        self.assertEqual(
            desired_plan_for_subscriptions(plans.PLAN_PRO, [apple, google], now=self.now),
            plans.PLAN_PRO,
        )
        self.assertIs(choose_effective_subscription([apple, google], now=self.now), google)

    def test_business_is_never_changed_by_subscription_state(self):
        self.assertEqual(
            desired_plan_for_subscriptions(
                plans.PLAN_BUSINESS,
                [self.sub(status="expired", days=-1)],
                now=self.now,
            ),
            plans.PLAN_BUSINESS,
        )

    def test_no_active_subscription_returns_free(self):
        self.assertEqual(
            desired_plan_for_subscriptions(
                plans.PLAN_PRO,
                [self.sub(status="expired", days=-1)],
                now=self.now,
            ),
            plans.PLAN_FREE,
        )


if __name__ == "__main__":
    unittest.main()
