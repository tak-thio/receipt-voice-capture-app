from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from app import billing


class AppleSubscriptionMappingTest(unittest.TestCase):
    def test_active_transaction_before_expiry_is_entitled(self):
        exp = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=10)

        result = billing.normalize_apple_subscription(
            {
                "productId": "pro_monthly",
                "transactionId": "200000000000001",
                "originalTransactionId": "100000000000001",
                "expiresDate": int(exp.timestamp() * 1000),
                "revocationDate": None,
                "environment": "Sandbox",
            },
            renewal_info=None,
            expected_product_id="pro_monthly",
        )

        self.assertTrue(result["active"])
        self.assertEqual(result["purchase_token"], "100000000000001")
        self.assertEqual(result["transaction_id"], "200000000000001")
        self.assertEqual(result["product_id"], "pro_monthly")
        self.assertEqual(result["expiry"], exp)
        self.assertEqual(result["state"], "active")
        self.assertEqual(result["environment"], "sandbox")

    def test_revoked_transaction_is_not_entitled(self):
        exp = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=10)

        result = billing.normalize_apple_subscription(
            {
                "productId": "pro_monthly",
                "transactionId": "200000000000002",
                "originalTransactionId": "100000000000002",
                "expiresDate": int(exp.timestamp() * 1000),
                "revocationDate": int(datetime.now(timezone.utc).timestamp() * 1000),
                "environment": "Sandbox",
            },
            renewal_info=None,
            expected_product_id="pro_monthly",
        )

        self.assertFalse(result["active"])
        self.assertEqual(result["state"], "revoked")

    def test_wrong_product_is_rejected(self):
        with self.assertRaises(ValueError):
            billing.normalize_apple_subscription(
                {
                    "productId": "other_plan",
                    "transactionId": "200000000000003",
                    "originalTransactionId": "100000000000003",
                    "expiresDate": None,
                    "revocationDate": None,
                    "environment": "Sandbox",
                },
                renewal_info=None,
                expected_product_id="pro_monthly",
            )

    def test_auto_renew_enum_off_marks_canceled_until_expiry(self):
        expiry = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=5)

        result = billing.normalize_apple_subscription(
            {
                "productId": "pro_monthly",
                "originalTransactionId": "100000000000005",
                "expiresDate": int(expiry.timestamp() * 1000),
                "environment": "Sandbox",
            },
            renewal_info={"autoRenewStatus": SimpleNamespace(value=0)},
            expected_product_id="pro_monthly",
        )

        self.assertTrue(result["active"])
        self.assertEqual(result["state"], "canceled_until_expiry")


class AppleSubscriptionVerificationTest(unittest.TestCase):
    def test_verify_returns_none_when_apple_verifier_is_not_configured(self):
        with patch.object(billing, "_apple_verifier", return_value=None):
            result = billing.verify_apple_subscription(
                signed_transaction_info="signed-jws",
                transaction_id=None,
                product_id="pro_monthly",
            )

        self.assertIsNone(result)

    def test_verify_signed_transaction_uses_verifier_payload(self):
        exp = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=10)
        transaction = {
            "productId": "pro_monthly",
            "transactionId": "200000000000004",
            "originalTransactionId": "100000000000004",
            "expiresDate": int(exp.timestamp() * 1000),
            "revocationDate": None,
            "environment": "Sandbox",
        }

        class FakeVerifier:
            def verify_and_decode_signed_transaction(self, signed_transaction):
                if signed_transaction != "signed-jws":
                    raise AssertionError("unexpected signed transaction")
                return transaction

        with (
            patch.object(billing, "_apple_verifier", return_value=FakeVerifier()),
            patch.object(billing, "_apple_api_client", return_value=None),
        ):
            result = billing.verify_apple_subscription(
                signed_transaction_info="signed-jws",
                transaction_id=None,
                product_id="pro_monthly",
            )

        self.assertIsNotNone(result)
        self.assertTrue(result["active"])
        self.assertEqual(result["purchase_token"], "100000000000004")
        self.assertEqual(result["expiry"], exp)


class AppleNotificationVerificationTest(unittest.TestCase):
    def test_decodes_nested_payload_and_maps_grace_period(self):
        grace_expiry = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=3)
        transaction = {
            "productId": "pro_monthly",
            "transactionId": "200000000000201",
            "originalTransactionId": "100000000000201",
            "expiresDate": int((datetime.now(timezone.utc) - timedelta(days=1)).timestamp() * 1000),
            "environment": "Sandbox",
        }
        renewal = {
            "gracePeriodExpiresDate": int(grace_expiry.timestamp() * 1000),
            "isInBillingRetryPeriod": True,
        }

        class FakeVerifier:
            def verify_and_decode_notification(self, signed_payload):
                self.assert_payload(signed_payload)
                return {
                    "notificationType": "DID_FAIL_TO_RENEW",
                    "subtype": "GRACE_PERIOD",
                    "data": {
                        "signedTransactionInfo": "transaction-jws",
                        "signedRenewalInfo": "renewal-jws",
                    },
                }

            @staticmethod
            def assert_payload(signed_payload):
                if signed_payload != "notification-jws":
                    raise AssertionError("unexpected notification payload")

            def verify_and_decode_signed_transaction(self, signed_payload):
                if signed_payload != "transaction-jws":
                    raise AssertionError("unexpected transaction payload")
                return transaction

            def verify_and_decode_renewal_info(self, signed_payload):
                if signed_payload != "renewal-jws":
                    raise AssertionError("unexpected renewal payload")
                return renewal

        with patch.object(billing, "_apple_verifier", return_value=FakeVerifier()):
            result = billing.verify_apple_notification(
                signed_payload="notification-jws",
                product_id="pro_monthly",
            )

        self.assertIsNotNone(result)
        self.assertFalse(result["test"])
        self.assertEqual(result["notification_type"], "DID_FAIL_TO_RENEW")
        self.assertEqual(result["subtype"], "GRACE_PERIOD")
        self.assertTrue(result["active"])
        self.assertEqual(result["state"], "grace")
        self.assertEqual(result["expiry"], grace_expiry)

    def test_test_notification_does_not_require_transaction(self):
        class FakeVerifier:
            @staticmethod
            def verify_and_decode_notification(signed_payload):
                return {"notificationType": "TEST"}

        with patch.object(billing, "_apple_verifier", return_value=FakeVerifier()):
            result = billing.verify_apple_notification(
                signed_payload="test-notification-jws",
                product_id="pro_monthly",
            )

        self.assertEqual(
            result,
            {"test": True, "notification_type": "TEST", "subtype": ""},
        )

    def test_expired_notification_overrides_still_valid_transaction(self):
        expiry = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=3)

        class FakeVerifier:
            @staticmethod
            def verify_and_decode_notification(signed_payload):
                return {
                    "notificationType": "EXPIRED",
                    "data": {"signedTransactionInfo": "transaction-jws"},
                }

            @staticmethod
            def verify_and_decode_signed_transaction(signed_payload):
                return {
                    "productId": "pro_monthly",
                    "originalTransactionId": "100000000000202",
                    "expiresDate": int(expiry.timestamp() * 1000),
                    "environment": "Sandbox",
                }

        with patch.object(billing, "_apple_verifier", return_value=FakeVerifier()):
            result = billing.verify_apple_notification(
                signed_payload="expired-notification-jws",
                product_id="pro_monthly",
            )

        self.assertFalse(result["active"])
        self.assertEqual(result["state"], "expired")

    def test_auto_renew_enabled_keeps_active_state(self):
        expiry = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=3)

        class FakeVerifier:
            @staticmethod
            def verify_and_decode_notification(signed_payload):
                return {
                    "notificationType": "DID_CHANGE_RENEWAL_STATUS",
                    "subtype": "AUTO_RENEW_ENABLED",
                    "data": {"signedTransactionInfo": "transaction-jws"},
                }

            @staticmethod
            def verify_and_decode_signed_transaction(signed_payload):
                return {
                    "productId": "pro_monthly",
                    "originalTransactionId": "100000000000203",
                    "expiresDate": int(expiry.timestamp() * 1000),
                    "environment": "Sandbox",
                }

        with patch.object(billing, "_apple_verifier", return_value=FakeVerifier()):
            result = billing.verify_apple_notification(
                signed_payload="renew-enabled-notification-jws",
                product_id="pro_monthly",
            )

        self.assertTrue(result["active"])
        self.assertEqual(result["state"], "active")

    def test_unknown_raw_notification_type_is_kept_for_diagnosis(self):
        expiry = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=3)

        class FakeVerifier:
            @staticmethod
            def verify_and_decode_notification(signed_payload):
                return {
                    "notificationType": None,
                    "rawNotificationType": "FUTURE_EVENT",
                    "data": {"signedTransactionInfo": "transaction-jws"},
                }

            @staticmethod
            def verify_and_decode_signed_transaction(signed_payload):
                return {
                    "productId": "pro_monthly",
                    "originalTransactionId": "100000000000204",
                    "expiresDate": int(expiry.timestamp() * 1000),
                    "environment": "Sandbox",
                }

        with patch.object(billing, "_apple_verifier", return_value=FakeVerifier()):
            result = billing.verify_apple_notification(
                signed_payload="future-notification-jws",
                product_id="pro_monthly",
            )

        self.assertTrue(result["active"])
        self.assertEqual(result["notification_type"], "FUTURE_EVENT")
        self.assertEqual(result["state"], "future_event")


if __name__ == "__main__":
    unittest.main()
