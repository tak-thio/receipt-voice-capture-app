import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
from unittest import mock
from unittest.mock import patch
from uuid import uuid4

from app import plans
from app import apple_reconciliation
from app.apple_reconciliation import reconcile_apple_subscriptions
from app.models import Firm, StoreNotificationEvent, Subscription


class FakeSession:
    def __init__(self, subscriptions, firms, events=None):
        self.subscriptions = subscriptions
        self.firms = firms
        self.events = events or []
        self.flushed = False

    async def scalars(self, statement):
        descriptions = getattr(statement, "column_descriptions", [])
        entity = descriptions[0].get("entity") if descriptions else None
        if entity is StoreNotificationEvent:
            return self.events
        if entity is Subscription:
            return self.subscriptions
        return []

    async def scalar(self, statement):
        descriptions = getattr(statement, "column_descriptions", [])
        entity = descriptions[0].get("entity") if descriptions else None
        if entity is Firm:
            firm_id = next(iter(statement.compile().params.values()), None)
            return self.firms.get(firm_id)
        return None

    async def get(self, model, object_id):
        if model is Firm:
            return self.firms.get(object_id)
        return None

    async def flush(self):
        self.flushed = True


class AppleReconciliationTest(unittest.IsolatedAsyncioTestCase):
    async def test_updates_subscription_and_resolves_pending_event(self):
        now = datetime.now(timezone.utc).replace(microsecond=0)
        firm_id = uuid4()
        sub = SimpleNamespace(
            id=uuid4(),
            firm_id=firm_id,
            platform="apple",
            product_id="pro_monthly",
            purchase_token="original-transaction",
            status="expired",
            current_period_end=now - timedelta(days=1),
            revoked_at=None,
            created_at=now,
        )
        firm = SimpleNamespace(id=firm_id, plan=plans.PLAN_FREE)
        event = SimpleNamespace(
            purchase_token=sub.purchase_token,
            status="pending",
            subscription_id=None,
            processed_at=None,
            last_error=None,
        )
        session = FakeSession([sub], {firm_id: firm}, [event])

        def verify(**kwargs):
            self.assertEqual(kwargs["transaction_id"], sub.purchase_token)
            return {
                "active": True,
                "authoritative": True,
                "product_id": "pro_monthly",
                "purchase_token": sub.purchase_token,
                "transaction_id": "latest-transaction",
                "expiry": now + timedelta(days=30),
                "state": "active",
                "environment": "production",
                "app_account_token": None,
                "auto_renew_enabled": True,
                "signed_at": now,
                "revoked_at": None,
            }

        stats = await reconcile_apple_subscriptions(
            session,
            verify_subscription=verify,
            product_id="pro_monthly",
            limit=100,
        )

        self.assertEqual(stats, {"seen": 1, "updated": 1, "failed": 0})
        self.assertEqual(sub.status, "active")
        self.assertEqual(sub.latest_transaction_id, "latest-transaction")
        self.assertEqual(firm.plan, plans.PLAN_PRO)
        self.assertEqual(event.status, "reconciled")
        self.assertEqual(event.subscription_id, sub.id)
        self.assertTrue(session.flushed)

    async def test_one_verification_failure_does_not_stop_the_batch(self):
        now = datetime.now(timezone.utc)
        first_firm = uuid4()
        second_firm = uuid4()
        subscriptions = [
            SimpleNamespace(
                id=uuid4(), firm_id=first_firm, platform="apple",
                product_id="pro_monthly", purchase_token="fails",
                status="active", current_period_end=now, revoked_at=None,
                created_at=now,
            ),
            SimpleNamespace(
                id=uuid4(), firm_id=second_firm, platform="apple",
                product_id="pro_monthly", purchase_token="works",
                status="expired", current_period_end=now, revoked_at=None,
                created_at=now,
            ),
        ]
        firms = {
            first_firm: SimpleNamespace(id=first_firm, plan=plans.PLAN_PRO),
            second_firm: SimpleNamespace(id=second_firm, plan=plans.PLAN_FREE),
        }
        session = FakeSession(subscriptions, firms)

        def verify(**kwargs):
            if kwargs["transaction_id"] == "fails":
                raise RuntimeError("temporary Apple failure")
            return {
                "active": True,
                "authoritative": True,
                "product_id": "pro_monthly",
                "purchase_token": "works",
                "transaction_id": "latest",
                "expiry": now + timedelta(days=30),
                "state": "active",
                "environment": "production",
            }

        with patch.object(apple_reconciliation._log, "exception") as log_exception:
            stats = await reconcile_apple_subscriptions(
                session,
                verify_subscription=verify,
                product_id="pro_monthly",
            )

        self.assertEqual(stats, {"seen": 2, "updated": 1, "failed": 1})
        self.assertEqual(subscriptions[1].status, "active")
        log_exception.assert_called_once()

    async def test_non_authoritative_fallback_cannot_replace_store_state(self):
        now = datetime.now(timezone.utc).replace(microsecond=0)
        firm_id = uuid4()
        sub = SimpleNamespace(
            id=uuid4(),
            firm_id=firm_id,
            platform="apple",
            product_id="pro_monthly",
            purchase_token="original-transaction",
            status="revoked",
            current_period_end=now + timedelta(days=30),
            latest_transaction_id="latest-transaction",
            revoked_at=now,
            created_at=now - timedelta(days=30),
        )
        firm = SimpleNamespace(id=firm_id, plan=plans.PLAN_FREE)
        session = FakeSession([sub], {firm_id: firm})

        def verify(**_kwargs):
            return {
                "active": True,
                "authoritative": False,
                "product_id": "pro_monthly",
                "purchase_token": sub.purchase_token,
                "transaction_id": "old-transaction",
                "expiry": now + timedelta(days=60),
                "state": "active",
                "environment": "production",
                "signed_at": now - timedelta(days=1),
                "revoked_at": None,
            }

        stats = await reconcile_apple_subscriptions(
            session,
            verify_subscription=verify,
            product_id="pro_monthly",
        )

        self.assertEqual(stats, {"seen": 1, "updated": 0, "failed": 1})
        self.assertEqual(sub.status, "revoked")
        self.assertEqual(sub.latest_transaction_id, "latest-transaction")
        self.assertEqual(sub.revoked_at, now)
        self.assertEqual(firm.plan, plans.PLAN_FREE)


class RunAppleReconcileLoopTest(unittest.IsolatedAsyncioTestCase):
    async def test_run_apple_reconcile_survives_tick_error(self):
        from app import worker

        tick_calls: list[int] = []

        async def fake_tick() -> dict:
            tick_calls.append(1)
            if len(tick_calls) == 1:
                raise RuntimeError("boom")  # 1回目は失敗させる
            return {"seen": 0, "updated": 0, "failed": 0}

        async def fake_sleep(_seconds) -> None:
            # tick を2回通したらループを止める(CancelledError は except Exception に捕まらない)
            if len(tick_calls) >= 2:
                raise asyncio.CancelledError

        with mock.patch.object(worker, "_apple_reconcile_tick", fake_tick), \
             mock.patch.object(worker.asyncio, "sleep", fake_sleep):
            with self.assertRaises(asyncio.CancelledError):
                await worker.run_apple_reconcile()

        # 1回目の例外でループが死なず、2回目の tick まで到達している
        self.assertGreaterEqual(len(tick_calls), 2)


if __name__ == "__main__":
    unittest.main()
