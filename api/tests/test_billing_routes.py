from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from pydantic import ValidationError

from app import plans
from app.models import Firm, Subscription
from app.routers import billing as billing_router


class FakeSession:
    def __init__(self, *, scalar_result=None, firm=None):
        self.scalar_result = scalar_result
        self.firm = firm
        self.added = []
        self.scalar_statement = None
        self.flushed = False

    async def scalar(self, statement):
        self.scalar_statement = statement
        return self.scalar_result

    def add(self, value):
        self.added.append(value)

    async def get(self, model, object_id):
        if model is Firm and self.firm and self.firm.id == object_id:
            return self.firm
        return None

    async def flush(self):
        self.flushed = True


class FakeTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class FakeOwnerSession(FakeSession):
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    def begin(self):
        return FakeTransaction()


class AppleVerifyBodyTest(unittest.TestCase):
    def test_requires_signed_transaction_or_transaction_id(self):
        with self.assertRaises(ValidationError):
            billing_router.AppleVerifyBody()

    def test_rejects_product_other_than_configured_pro_product(self):
        with self.assertRaises(ValidationError):
            billing_router.AppleVerifyBody(
                signed_transaction_info="signed-jws",
                product_id="cheaper_product",
            )


class AppleVerifyRouteTest(unittest.IsolatedAsyncioTestCase):
    async def test_creates_apple_subscription_from_original_transaction_id(self):
        firm_id = uuid4()
        firm = SimpleNamespace(id=firm_id, plan=plans.PLAN_FREE)
        principal = SimpleNamespace(memberships=[SimpleNamespace(firm_id=firm_id)])
        session = FakeSession(firm=firm)
        expiry = datetime.now(timezone.utc) + timedelta(days=30)
        verification = {
            "active": True,
            "product_id": "pro_monthly",
            "purchase_token": "100000000000101",
            "transaction_id": "200000000000101",
            "expiry": expiry,
            "state": "active",
            "environment": "sandbox",
        }

        with (
            patch.object(
                billing_router,
                "run_in_threadpool",
                new=AsyncMock(return_value=verification),
            ) as run_verify,
            patch.object(
                billing_router.metering,
                "monthly_usage",
                new=AsyncMock(return_value=0),
            ),
        ):
            response = await billing_router.apple_verify(
                billing_router.AppleVerifyBody(signed_transaction_info="signed-jws"),
                principal,
                session,
            )

        run_verify.assert_awaited_once_with(
            billing_router.billing.verify_apple_subscription,
            signed_transaction_info="signed-jws",
            transaction_id=None,
            product_id="pro_monthly",
        )
        self.assertEqual(response, {"plan": "pro", "active": True, "used": 0, "cap": 500})
        self.assertTrue(session.flushed)
        self.assertEqual(len(session.added), 1)
        subscription = session.added[0]
        self.assertIsInstance(subscription, Subscription)
        self.assertEqual(subscription.firm_id, firm_id)
        self.assertEqual(subscription.platform, "apple")
        self.assertEqual(subscription.purchase_token, "100000000000101")
        self.assertEqual(subscription.current_period_end, expiry)

        compiled = session.scalar_statement.compile()
        self.assertIn("subscriptions.platform", str(compiled))
        self.assertIn("apple", compiled.params.values())
        self.assertIn("100000000000101", compiled.params.values())


class AppleNotificationRouteTest(unittest.IsolatedAsyncioTestCase):
    async def test_unknown_original_transaction_is_acknowledged(self):
        notification = {
            "test": False,
            "notification_type": "DID_RENEW",
            "subtype": "",
            "active": True,
            "product_id": "pro_monthly",
            "purchase_token": "100000000000301",
            "expiry": datetime.now(timezone.utc) + timedelta(days=30),
            "state": "active",
        }
        owner_session = FakeOwnerSession(scalar_result=None)

        with (
            patch.object(
                billing_router,
                "run_in_threadpool",
                new=AsyncMock(return_value=notification),
            ),
            patch.object(billing_router, "OwnerSessionLocal", return_value=owner_session),
        ):
            response = await billing_router.apple_notifications(
                billing_router.AppleNotificationBody(signedPayload="notification-jws")
            )

        self.assertEqual(response, {"ok": True})
        compiled = owner_session.scalar_statement.compile()
        self.assertIn("apple", compiled.params.values())
        self.assertIn("100000000000301", compiled.params.values())

    async def test_expired_notification_downgrades_personal_pro(self):
        firm_id = uuid4()
        firm = SimpleNamespace(id=firm_id, plan=plans.PLAN_PRO)
        subscription = SimpleNamespace(
            firm_id=firm_id,
            status="active",
            current_period_end=None,
        )
        expiry = datetime.now(timezone.utc) - timedelta(seconds=1)
        notification = {
            "test": False,
            "notification_type": "EXPIRED",
            "subtype": "",
            "active": False,
            "product_id": "pro_monthly",
            "purchase_token": "100000000000302",
            "expiry": expiry,
            "state": "expired",
        }
        owner_session = FakeOwnerSession(scalar_result=subscription, firm=firm)

        with (
            patch.object(
                billing_router,
                "run_in_threadpool",
                new=AsyncMock(return_value=notification),
            ),
            patch.object(billing_router, "OwnerSessionLocal", return_value=owner_session),
        ):
            response = await billing_router.apple_notifications(
                billing_router.AppleNotificationBody(signedPayload="notification-jws")
            )

        self.assertEqual(response, {"ok": True})
        self.assertEqual(subscription.status, "expired")
        self.assertEqual(subscription.current_period_end, expiry)
        self.assertEqual(firm.plan, plans.PLAN_FREE)

    async def test_expired_notification_never_downgrades_business(self):
        firm_id = uuid4()
        firm = SimpleNamespace(id=firm_id, plan=plans.PLAN_BUSINESS)
        subscription = SimpleNamespace(firm_id=firm_id, status="active", current_period_end=None)
        notification = {
            "test": False,
            "notification_type": "REVOKE",
            "subtype": "",
            "active": False,
            "product_id": "pro_monthly",
            "purchase_token": "100000000000303",
            "expiry": None,
            "state": "revoked",
        }
        owner_session = FakeOwnerSession(scalar_result=subscription, firm=firm)

        with (
            patch.object(
                billing_router,
                "run_in_threadpool",
                new=AsyncMock(return_value=notification),
            ),
            patch.object(billing_router, "OwnerSessionLocal", return_value=owner_session),
        ):
            await billing_router.apple_notifications(
                billing_router.AppleNotificationBody(signedPayload="notification-jws")
            )

        self.assertEqual(firm.plan, plans.PLAN_BUSINESS)

    async def test_stale_expired_notification_does_not_replace_newer_renewal(self):
        firm_id = uuid4()
        current_expiry = datetime.now(timezone.utc) + timedelta(days=30)
        stale_expiry = datetime.now(timezone.utc) + timedelta(days=1)
        firm = SimpleNamespace(id=firm_id, plan=plans.PLAN_PRO)
        subscription = SimpleNamespace(
            firm_id=firm_id,
            status="active",
            current_period_end=current_expiry,
        )
        notification = {
            "test": False,
            "notification_type": "EXPIRED",
            "subtype": "",
            "active": False,
            "product_id": "pro_monthly",
            "purchase_token": "100000000000304",
            "expiry": stale_expiry,
            "state": "expired",
        }
        owner_session = FakeOwnerSession(scalar_result=subscription, firm=firm)

        with (
            patch.object(
                billing_router,
                "run_in_threadpool",
                new=AsyncMock(return_value=notification),
            ),
            patch.object(billing_router, "OwnerSessionLocal", return_value=owner_session),
        ):
            response = await billing_router.apple_notifications(
                billing_router.AppleNotificationBody(signedPayload="notification-jws")
            )

        self.assertEqual(response, {"ok": True})
        self.assertEqual(subscription.status, "active")
        self.assertEqual(subscription.current_period_end, current_expiry)
        self.assertEqual(firm.plan, plans.PLAN_PRO)


class BillingSubscriptionRouteTest(unittest.IsolatedAsyncioTestCase):
    async def test_returns_latest_entitled_subscription_for_current_firm(self):
        firm_id = uuid4()
        expiry = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=12)
        subscription = SimpleNamespace(
            platform="apple",
            product_id="pro_monthly",
            status="canceled_until_expiry",
            current_period_end=expiry,
        )
        principal = SimpleNamespace(memberships=[SimpleNamespace(firm_id=firm_id)])
        session = FakeSession(scalar_result=subscription)

        response = await billing_router.billing_subscription(principal, session)

        self.assertEqual(
            response,
            {
                "active": True,
                "platform": "apple",
                "productId": "pro_monthly",
                "currentPeriodEnd": expiry.isoformat(),
            },
        )
        compiled = session.scalar_statement.compile()
        self.assertIn(firm_id, compiled.params.values())
        self.assertIn("subscriptions.current_period_end DESC NULLS LAST", str(compiled))
        self.assertIn("subscriptions.created_at DESC", str(compiled))

    def test_full_google_revoked_state_is_not_active(self):
        subscription = SimpleNamespace(
            status="SUBSCRIPTION_STATE_ON_HOLD",
            current_period_end=datetime.now(timezone.utc) + timedelta(days=2),
        )

        self.assertFalse(billing_router._subscription_is_active(subscription))

    async def test_returns_empty_summary_when_firm_has_no_subscription(self):
        firm_id = uuid4()
        principal = SimpleNamespace(memberships=[SimpleNamespace(firm_id=firm_id)])
        session = FakeSession(scalar_result=None)

        response = await billing_router.billing_subscription(principal, session)

        self.assertEqual(
            response,
            {
                "active": False,
                "platform": None,
                "productId": None,
                "currentPeriodEnd": None,
            },
        )


if __name__ == "__main__":
    unittest.main()
