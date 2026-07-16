from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app import plans
from app.models import Firm, StoreNotificationEvent, Subscription
from app.routers import billing as billing_router


class FakeSession:
    def __init__(
        self, *, scalar_result=None, scalar_results=None, event_result=None, firm=None
    ):
        self.scalar_result = scalar_result
        self.scalar_results = scalar_results
        self.event_result = event_result
        self.firm = firm
        self.added = []
        self.scalar_statement = None
        self.scalar_statements = []
        self.flushed = False
        self.flush_exception = None
        self.rolled_back = False

    async def scalar(self, statement):
        self.scalar_statement = statement
        self.scalar_statements.append(statement)
        descriptions = getattr(statement, "column_descriptions", [])
        entity = descriptions[0].get("entity") if descriptions else None
        if entity is Firm:
            return self.firm
        if entity is StoreNotificationEvent:
            return self.event_result
        return self.scalar_result

    async def scalars(self, statement):
        self.scalar_statement = statement
        self.scalar_statements.append(statement)
        if self.scalar_results is not None:
            return self.scalar_results
        added_subscriptions = [
            value for value in self.added if isinstance(value, Subscription)
        ]
        if added_subscriptions:
            return added_subscriptions
        return [self.scalar_result] if self.scalar_result is not None else []

    def add(self, value):
        self.added.append(value)

    async def get(self, model, object_id):
        if model is Firm and self.firm and self.firm.id == object_id:
            return self.firm
        return None

    async def flush(self):
        if self.flush_exception:
            raise self.flush_exception
        self.flushed = True

    async def rollback(self):
        self.rolled_back = True


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
    async def test_existing_original_transaction_cannot_be_claimed_by_another_firm(self):
        firm_id = uuid4()
        firm = SimpleNamespace(
            id=firm_id,
            plan=plans.PLAN_FREE,
            billing_account_token=None,
        )
        principal = SimpleNamespace(memberships=[SimpleNamespace(firm_id=firm_id)])
        session = FakeSession(firm=firm)
        session.flush_exception = IntegrityError(
            "INSERT INTO subscriptions", {}, Exception("uq_sub_token")
        )
        verification = {
            "active": True,
            "product_id": "pro_monthly",
            "purchase_token": "already-owned-original-transaction",
            "transaction_id": "new-transaction",
            "expiry": datetime.now(timezone.utc) + timedelta(days=30),
            "state": "active",
            "environment": "sandbox",
        }

        with (
            patch.object(
                billing_router,
                "run_in_threadpool",
                new=AsyncMock(return_value=verification),
            ),
            patch.object(
                billing_router.metering,
                "monthly_usage",
                new=AsyncMock(return_value=0),
            ),
        ):
            with self.assertRaises(billing_router.HTTPException) as raised:
                await billing_router.apple_verify(
                    billing_router.AppleVerifyBody(signed_transaction_info="signed-jws"),
                    principal,
                    session,
                )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertTrue(session.rolled_back)

    async def test_purchase_context_is_stable_for_the_current_firm(self):
        firm_id = uuid4()
        firm = SimpleNamespace(id=firm_id, billing_account_token=None)
        principal = SimpleNamespace(memberships=[SimpleNamespace(firm_id=firm_id)])
        session = FakeSession(firm=firm)

        first = await billing_router.apple_purchase_context(principal, session)
        second = await billing_router.apple_purchase_context(principal, session)

        self.assertEqual(first, second)
        self.assertEqual(UUID(first["appAccountToken"]), firm.billing_account_token)
        self.assertTrue(session.flushed)

    async def test_rejects_transaction_for_a_different_app_account_token(self):
        firm_id = uuid4()
        firm = SimpleNamespace(
            id=firm_id,
            plan=plans.PLAN_FREE,
            billing_account_token=uuid4(),
        )
        principal = SimpleNamespace(memberships=[SimpleNamespace(firm_id=firm_id)])
        session = FakeSession(firm=firm)
        verification = {
            "active": True,
            "product_id": "pro_monthly",
            "purchase_token": "100000000000199",
            "transaction_id": "200000000000199",
            "expiry": datetime.now(timezone.utc) + timedelta(days=30),
            "state": "active",
            "environment": "sandbox",
            "app_account_token": str(uuid4()),
            "auto_renew_enabled": True,
            "signed_at": datetime.now(timezone.utc),
            "revoked_at": None,
        }

        with patch.object(
            billing_router,
            "run_in_threadpool",
            new=AsyncMock(return_value=verification),
        ):
            with self.assertRaises(billing_router.HTTPException) as raised:
                await billing_router.apple_verify(
                    billing_router.AppleVerifyBody(signed_transaction_info="signed-jws"),
                    principal,
                    session,
                )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(session.added, [])

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

        subscription_statement = next(
            statement
            for statement in session.scalar_statements
            if statement.column_descriptions[0].get("entity") is Subscription
        )
        compiled = subscription_statement.compile()
        self.assertIn("subscriptions.platform", str(compiled))
        self.assertIn("apple", compiled.params.values())
        self.assertIn("100000000000101", compiled.params.values())

    async def test_expired_verification_recomputes_and_downgrades_personal_plan(self):
        firm_id = uuid4()
        firm = SimpleNamespace(id=firm_id, plan=plans.PLAN_PRO)
        subscription = SimpleNamespace(
            firm_id=firm_id,
            platform="apple",
            product_id="pro_monthly",
            purchase_token="100000000000102",
            status="active",
            current_period_end=datetime.now(timezone.utc) + timedelta(days=1),
            revoked_at=None,
            created_at=datetime.now(timezone.utc),
        )
        principal = SimpleNamespace(memberships=[SimpleNamespace(firm_id=firm_id)])
        session = FakeSession(
            firm=firm,
            scalar_result=subscription,
            scalar_results=[subscription],
        )
        verification = {
            "active": False,
            "authoritative": True,
            "product_id": "pro_monthly",
            "purchase_token": subscription.purchase_token,
            "transaction_id": "200000000000102",
            "expiry": datetime.now(timezone.utc) - timedelta(seconds=1),
            "state": "expired",
            "environment": "sandbox",
        }

        with (
            patch.object(
                billing_router,
                "run_in_threadpool",
                new=AsyncMock(return_value=verification),
            ),
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

        self.assertEqual(firm.plan, plans.PLAN_FREE)
        self.assertEqual(response["plan"], plans.PLAN_FREE)
        subscription_queries = [
            statement
            for statement in session.scalar_statements
            if statement.column_descriptions[0].get("entity") is Subscription
        ]
        self.assertTrue(subscription_queries)
        self.assertIsNotNone(subscription_queries[0]._for_update_arg)

    async def test_older_direct_verification_cannot_replace_newer_store_state(self):
        firm_id = uuid4()
        newest = datetime.now(timezone.utc)
        revoked_at = newest - timedelta(minutes=1)
        firm = SimpleNamespace(id=firm_id, plan=plans.PLAN_FREE)
        subscription = SimpleNamespace(
            firm_id=firm_id,
            platform="apple",
            product_id="pro_monthly",
            purchase_token="100000000000103",
            status="revoked",
            current_period_end=newest + timedelta(days=10),
            latest_transaction_id="200000000000103",
            store_environment="production",
            app_account_token=None,
            auto_renew_enabled=False,
            latest_store_signed_at=newest,
            last_verified_at=newest,
            revoked_at=revoked_at,
            created_at=newest - timedelta(days=30),
        )
        principal = SimpleNamespace(memberships=[SimpleNamespace(firm_id=firm_id)])
        session = FakeSession(
            firm=firm,
            scalar_result=subscription,
            scalar_results=[subscription],
        )
        verification = {
            "active": True,
            "product_id": "pro_monthly",
            "purchase_token": subscription.purchase_token,
            "transaction_id": "200000000000102",
            "expiry": newest + timedelta(days=30),
            "state": "active",
            "environment": "production",
            "app_account_token": None,
            "auto_renew_enabled": True,
            "signed_at": newest - timedelta(minutes=5),
            "revoked_at": None,
        }

        with (
            patch.object(
                billing_router,
                "run_in_threadpool",
                new=AsyncMock(return_value=verification),
            ),
            patch.object(
                billing_router.metering,
                "monthly_usage",
                new=AsyncMock(return_value=0),
            ),
        ):
            response = await billing_router.apple_verify(
                billing_router.AppleVerifyBody(signed_transaction_info="old-signed-jws"),
                principal,
                session,
            )

        self.assertEqual(subscription.status, "revoked")
        self.assertEqual(subscription.latest_store_signed_at, newest)
        self.assertEqual(subscription.revoked_at, revoked_at)
        self.assertEqual(firm.plan, plans.PLAN_FREE)
        self.assertEqual(response["plan"], plans.PLAN_FREE)
        self.assertFalse(response["active"])

    async def test_non_authoritative_verification_cannot_replace_legacy_store_state(self):
        firm_id = uuid4()
        expiry = datetime.now(timezone.utc) + timedelta(days=10)
        revoked_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        firm = SimpleNamespace(id=firm_id, plan=plans.PLAN_FREE)
        subscription = SimpleNamespace(
            firm_id=firm_id,
            platform="apple",
            product_id="pro_monthly",
            purchase_token="100000000000104",
            status="revoked",
            current_period_end=expiry,
            latest_transaction_id="200000000000104",
            store_environment="production",
            app_account_token=None,
            auto_renew_enabled=None,
            latest_store_signed_at=None,
            last_verified_at=None,
            revoked_at=revoked_at,
            created_at=datetime.now(timezone.utc) - timedelta(days=30),
        )
        principal = SimpleNamespace(memberships=[SimpleNamespace(firm_id=firm_id)])
        session = FakeSession(
            firm=firm,
            scalar_result=subscription,
            scalar_results=[subscription],
        )
        verification = {
            "active": True,
            "authoritative": False,
            "product_id": "pro_monthly",
            "purchase_token": subscription.purchase_token,
            "transaction_id": "old-transaction",
            "expiry": expiry,
            "state": "active",
            "environment": "production",
            "app_account_token": None,
            "auto_renew_enabled": True,
            "signed_at": datetime.now(timezone.utc) - timedelta(days=1),
            "revoked_at": None,
        }

        with (
            patch.object(
                billing_router,
                "run_in_threadpool",
                new=AsyncMock(return_value=verification),
            ),
            patch.object(
                billing_router.metering,
                "monthly_usage",
                new=AsyncMock(return_value=0),
            ),
        ):
            response = await billing_router.apple_verify(
                billing_router.AppleVerifyBody(signed_transaction_info="old-signed-jws"),
                principal,
                session,
            )

        self.assertEqual(subscription.status, "revoked")
        self.assertEqual(subscription.revoked_at, revoked_at)
        self.assertEqual(firm.plan, plans.PLAN_FREE)
        self.assertFalse(response["active"])


class AppleNotificationRouteTest(unittest.IsolatedAsyncioTestCase):
    async def test_duplicate_notification_uuid_is_acknowledged_without_reapplying(self):
        existing = SimpleNamespace(
            notification_uuid="duplicate-uuid", status="processed", attempts=1
        )
        owner_session = FakeOwnerSession(event_result=existing)
        notification = {
            "test": False,
            "notification_uuid": "duplicate-uuid",
            "signed_at": datetime.now(timezone.utc),
            "environment": "sandbox",
            "notification_type": "DID_RENEW",
            "subtype": "",
            "active": True,
            "product_id": "pro_monthly",
            "purchase_token": "100000000000390",
            "expiry": datetime.now(timezone.utc) + timedelta(days=30),
            "state": "active",
        }

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

        self.assertEqual(response, {"ok": True, "duplicate": True})
        self.assertEqual(existing.attempts, 2)
        self.assertEqual(owner_session.added, [])

    async def test_unknown_transaction_is_saved_as_pending(self):
        owner_session = FakeOwnerSession(scalar_result=None)
        notification = {
            "test": False,
            "notification_uuid": "pending-uuid",
            "signed_at": datetime.now(timezone.utc),
            "environment": "sandbox",
            "notification_type": "DID_RENEW",
            "subtype": "",
            "active": True,
            "product_id": "pro_monthly",
            "purchase_token": "100000000000391",
            "expiry": datetime.now(timezone.utc) + timedelta(days=30),
            "state": "active",
        }

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
        self.assertEqual(len(owner_session.added), 1)
        event = owner_session.added[0]
        self.assertIsInstance(event, StoreNotificationEvent)
        self.assertEqual(event.status, "pending")
        self.assertEqual(event.purchase_token, "100000000000391")

    async def test_environment_route_rejects_verified_payload_from_other_environment(self):
        notification = {
            "test": False,
            "notification_uuid": "wrong-env-uuid",
            "signed_at": datetime.now(timezone.utc),
            "environment": "production",
            "notification_type": "DID_RENEW",
            "subtype": "",
            "active": True,
            "product_id": "pro_monthly",
            "purchase_token": "100000000000392",
            "expiry": datetime.now(timezone.utc) + timedelta(days=30),
            "state": "active",
        }

        with patch.object(
            billing_router,
            "run_in_threadpool",
            new=AsyncMock(return_value=notification),
        ):
            with self.assertRaises(billing_router.HTTPException) as raised:
                await billing_router.apple_notifications_for_environment(
                    "sandbox",
                    billing_router.AppleNotificationBody(signedPayload="notification-jws"),
                )

        self.assertEqual(raised.exception.status_code, 400)

    async def test_older_signed_date_cannot_replace_newer_store_state(self):
        firm_id = uuid4()
        newest = datetime.now(timezone.utc)
        subscription = SimpleNamespace(
            id=uuid4(),
            firm_id=firm_id,
            status="active",
            current_period_end=newest + timedelta(days=10),
            latest_store_signed_at=newest,
        )
        owner_session = FakeOwnerSession(scalar_result=subscription)
        notification = {
            "test": False,
            "notification_uuid": "stale-signed-uuid",
            "signed_at": newest - timedelta(minutes=5),
            "environment": "sandbox",
            "notification_type": "EXPIRED",
            "subtype": "",
            "active": False,
            "product_id": "pro_monthly",
            "purchase_token": "100000000000393",
            "expiry": newest + timedelta(days=30),
            "state": "expired",
        }

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
        self.assertEqual(owner_session.added[0].status, "ignored_stale")
        subscription_queries = [
            statement
            for statement in owner_session.scalar_statements
            if statement.column_descriptions[0].get("entity") is Subscription
        ]
        self.assertTrue(subscription_queries)
        self.assertIsNotNone(subscription_queries[0]._for_update_arg)

    async def test_missing_signed_date_cannot_replace_timestamped_store_state(self):
        firm_id = uuid4()
        newest = datetime.now(timezone.utc)
        subscription = SimpleNamespace(
            id=uuid4(),
            firm_id=firm_id,
            status="revoked",
            current_period_end=newest + timedelta(days=10),
            latest_store_signed_at=newest,
        )
        owner_session = FakeOwnerSession(scalar_result=subscription)
        notification = {
            "test": False,
            "notification_uuid": "missing-signed-uuid",
            "signed_at": None,
            "environment": "sandbox",
            "notification_type": "DID_RENEW",
            "subtype": "",
            "active": True,
            "product_id": "pro_monthly",
            "purchase_token": "100000000000394",
            "expiry": newest + timedelta(days=30),
            "state": "active",
        }

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
        self.assertEqual(subscription.status, "revoked")
        self.assertEqual(owner_session.added[0].status, "ignored_stale")

    async def test_expired_apple_notification_keeps_pro_when_google_is_active(self):
        firm_id = uuid4()
        firm = SimpleNamespace(id=firm_id, plan=plans.PLAN_PRO)
        apple = SimpleNamespace(
            id=uuid4(),
            firm_id=firm_id,
            platform="apple",
            status="active",
            current_period_end=None,
            revoked_at=None,
            created_at=datetime.now(timezone.utc),
        )
        google = SimpleNamespace(
            id=uuid4(),
            firm_id=firm_id,
            platform="google",
            status="active",
            current_period_end=datetime.now(timezone.utc) + timedelta(days=10),
            revoked_at=None,
            created_at=datetime.now(timezone.utc),
        )
        notification = {
            "test": False,
            "notification_type": "EXPIRED",
            "subtype": "",
            "active": False,
            "product_id": "pro_monthly",
            "purchase_token": "100000000000399",
            "expiry": datetime.now(timezone.utc) - timedelta(seconds=1),
            "state": "expired",
        }
        owner_session = FakeOwnerSession(
            scalar_result=apple,
            scalar_results=[apple, google],
            firm=firm,
        )

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

        self.assertEqual(firm.plan, plans.PLAN_PRO)

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
    async def test_keeps_latest_expired_store_metadata_for_backward_compatibility(self):
        firm_id = uuid4()
        expiry = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(days=1)
        subscription = SimpleNamespace(
            platform="apple",
            product_id="pro_monthly",
            status="expired",
            current_period_end=expiry,
            revoked_at=None,
            created_at=expiry - timedelta(days=30),
        )
        principal = SimpleNamespace(memberships=[SimpleNamespace(firm_id=firm_id)])
        session = FakeSession(scalar_results=[subscription])

        response = await billing_router.billing_subscription(principal, session)

        self.assertEqual(
            response,
            {
                "active": False,
                "platform": "apple",
                "activePlatforms": [],
                "managementPlatforms": [],
                "productId": "pro_monthly",
                "currentPeriodEnd": expiry.isoformat(),
            },
        )

    async def test_uses_active_google_when_newer_apple_subscription_is_expired(self):
        firm_id = uuid4()
        now = datetime.now(timezone.utc).replace(microsecond=0)
        apple = SimpleNamespace(
            platform="apple",
            product_id="pro_monthly",
            status="expired",
            current_period_end=now - timedelta(days=1),
            revoked_at=None,
            created_at=now,
        )
        google = SimpleNamespace(
            platform="google",
            product_id="pro_monthly",
            status="active",
            current_period_end=now + timedelta(days=5),
            revoked_at=None,
            created_at=now - timedelta(days=30),
        )
        principal = SimpleNamespace(memberships=[SimpleNamespace(firm_id=firm_id)])
        session = FakeSession(scalar_results=[apple, google])

        response = await billing_router.billing_subscription(principal, session)

        self.assertTrue(response["active"])
        self.assertEqual(response["platform"], "google")
        self.assertEqual(response["activePlatforms"], ["google"])
        self.assertEqual(response["managementPlatforms"], ["google"])

    async def test_returns_all_active_platforms_when_apple_and_google_are_entitled(self):
        firm_id = uuid4()
        now = datetime.now(timezone.utc).replace(microsecond=0)
        apple = SimpleNamespace(
            platform="apple",
            product_id="pro_monthly",
            status="active",
            current_period_end=now + timedelta(days=4),
            revoked_at=None,
            created_at=now,
        )
        google = SimpleNamespace(
            platform="google",
            product_id="pro_monthly",
            status="active",
            current_period_end=now + timedelta(days=8),
            revoked_at=None,
            created_at=now,
        )
        principal = SimpleNamespace(memberships=[SimpleNamespace(firm_id=firm_id)])
        session = FakeSession(scalar_results=[google, apple])

        response = await billing_router.billing_subscription(principal, session)

        self.assertEqual(response["activePlatforms"], ["google", "apple"])
        self.assertEqual(response["managementPlatforms"], ["google", "apple"])

    async def test_apple_billing_retry_still_requires_store_management(self):
        firm_id = uuid4()
        now = datetime.now(timezone.utc).replace(microsecond=0)
        apple = SimpleNamespace(
            platform="apple",
            product_id="pro_monthly",
            status="billing_retry",
            current_period_end=now - timedelta(days=1),
            revoked_at=None,
            auto_renew_enabled=True,
            created_at=now - timedelta(days=30),
        )
        principal = SimpleNamespace(memberships=[SimpleNamespace(firm_id=firm_id)])
        session = FakeSession(scalar_results=[apple])

        response = await billing_router.billing_subscription(principal, session)

        self.assertFalse(response["active"])
        self.assertEqual(response["activePlatforms"], [])
        self.assertEqual(response.get("managementPlatforms"), ["apple"])

    async def test_apple_billing_retry_with_unknown_renewal_still_requires_management(self):
        firm_id = uuid4()
        now = datetime.now(timezone.utc).replace(microsecond=0)
        apple = SimpleNamespace(
            platform="apple",
            product_id="pro_monthly",
            status="billing_retry",
            current_period_end=now - timedelta(days=1),
            revoked_at=None,
            auto_renew_enabled=None,
            created_at=now - timedelta(days=30),
        )
        principal = SimpleNamespace(memberships=[SimpleNamespace(firm_id=firm_id)])
        session = FakeSession(scalar_results=[apple])

        response = await billing_router.billing_subscription(principal, session)

        self.assertFalse(response["active"])
        self.assertEqual(response["managementPlatforms"], ["apple"])

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
                "activePlatforms": ["apple"],
                "managementPlatforms": ["apple"],
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
                "activePlatforms": [],
                "managementPlatforms": [],
                "productId": None,
                "currentPeriodEnd": None,
            },
        )


if __name__ == "__main__":
    unittest.main()
