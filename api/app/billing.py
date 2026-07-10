"""アプリ内課金(IAP)の購入検証。Android=Google Play Developer API。

サービスアカウント鍵(play_service_account_path)が未設定なら検証は無効(None)。
purchase_token を Play に問い合わせ、購読状態と期限を返す。ブロッキングなので呼び出し側は
run_in_threadpool で呼ぶこと。更新/解約の反映はストア通知(RTDN)で別途行う想定。
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import get_settings

_log = logging.getLogger("billing")
_settings = get_settings()
# 課金が有効とみなす購読状態。
_ACTIVE_STATES = {"SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"}
_APPLE_ENV_ALIASES = {
    "sandbox": "SANDBOX",
    "production": "PRODUCTION",
    "xcode": "XCODE",
    "localtesting": "LOCAL_TESTING",
    "local_testing": "LOCAL_TESTING",
}


def _publisher():
    path = _settings.play_service_account_path
    if not path:
        return None
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        creds = service_account.Credentials.from_service_account_file(
            path, scopes=["https://www.googleapis.com/auth/androidpublisher"]
        )
        return build("androidpublisher", "v3", credentials=creds, cache_discovery=False)
    except Exception:
        _log.exception("Play publisher init failed (path=%s)", path)
        return None


def verify_google_subscription(purchase_token: str, product_id: str) -> dict | None:
    """購入トークンを Play に問い合わせる。{active, product_id, expiry, state} を返す。
    課金未設定/検証失敗は None。"""
    svc = _publisher()
    if svc is None:
        return None
    try:
        res = (
            svc.purchases()
            .subscriptionsv2()
            .get(packageName=_settings.play_package_name, token=purchase_token)
            .execute()
        )
    except Exception:
        _log.exception("Play subscription verify failed")
        return None

    state = res.get("subscriptionState", "")
    items = res.get("lineItems") or []
    item = next((i for i in items if i.get("productId") == product_id), items[0] if items else {})
    exp_dt = None
    expiry = item.get("expiryTime")
    if expiry:
        try:
            exp_dt = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
        except ValueError:
            exp_dt = None
    return {
        "active": state in _ACTIVE_STATES,
        "product_id": item.get("productId") or product_id,
        "expiry": exp_dt,
        "state": state or "UNKNOWN",
    }


def _field(payload: object | dict | None, *names: str, default: Any = None) -> Any:
    if payload is None:
        return default
    for name in names:
        if isinstance(payload, dict) and name in payload:
            return payload[name]
        if not isinstance(payload, dict) and hasattr(payload, name):
            return getattr(payload, name)
    return default


def _apple_datetime(value: object | None) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromtimestamp(int(value) / 1000, timezone.utc)
        except (TypeError, ValueError, OSError):
            return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _apple_environment_name(value: object | None) -> str:
    raw = getattr(value, "value", value)
    normalized = str(raw or "").strip().replace("-", "_").replace(" ", "_")
    aliases = {
        "Sandbox": "sandbox",
        "Production": "production",
        "Xcode": "xcode",
        "LocalTesting": "local_testing",
        "Local_Testing": "local_testing",
    }
    return aliases.get(normalized, normalized.lower())


def _apple_bool(value: object | None) -> bool:
    raw = getattr(value, "value", value)
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, int):
        return raw != 0
    return str(raw or "").strip().lower() in {"1", "true", "yes"}


def normalize_apple_subscription(
    transaction: object | dict,
    renewal_info: object | dict | None,
    expected_product_id: str,
) -> dict:
    """StoreKit/App Store Server の transaction を購読状態へ正規化する。"""
    product_id = _field(transaction, "productId", "productID")
    if product_id != expected_product_id:
        raise ValueError("Apple subscription product mismatch")

    transaction_id = _field(transaction, "transactionId", "transactionID")
    purchase_token = _field(transaction, "originalTransactionId", "originalTransactionID")
    if not purchase_token:
        raise ValueError("Apple original transaction id is missing")

    expires_at = _apple_datetime(_field(transaction, "expiresDate"))
    revoked_at = _apple_datetime(_field(transaction, "revocationDate"))
    grace_expires_at = _apple_datetime(_field(renewal_info, "gracePeriodExpiresDate"))
    auto_renew_status_value = _field(renewal_info, "autoRenewStatus")
    auto_renew_status = getattr(auto_renew_status_value, "value", auto_renew_status_value)
    is_billing_retry = _apple_bool(_field(renewal_info, "isInBillingRetryPeriod"))

    now = datetime.now(timezone.utc)
    state = "expired"
    active = False
    effective_expiry = expires_at

    if revoked_at:
        state = "revoked"
    elif expires_at and expires_at > now:
        active = True
        state = "canceled_until_expiry" if auto_renew_status in {0, "0"} else "active"
    elif grace_expires_at and grace_expires_at > now:
        active = True
        state = "grace"
        effective_expiry = grace_expires_at
    elif is_billing_retry:
        state = "billing_retry"

    return {
        "active": active,
        "product_id": product_id,
        "purchase_token": str(purchase_token),
        "transaction_id": str(transaction_id) if transaction_id else None,
        "expiry": effective_expiry,
        "state": state,
        "environment": _apple_environment_name(_field(transaction, "environment")),
    }


def _apple_environment():
    try:
        from appstoreserverlibrary.models.Environment import Environment
    except Exception:
        _log.exception("App Store Server library is not available")
        return None

    key = _settings.apple_environment.strip().replace("-", "_").lower()
    attr = _APPLE_ENV_ALIASES.get(key)
    if not attr:
        _log.error("Unsupported Apple environment: %s", _settings.apple_environment)
        return None
    return getattr(Environment, attr, None)


def _apple_root_certificates() -> list[bytes] | None:
    paths = [p.strip() for p in _settings.apple_root_certificate_paths.split(",") if p.strip()]
    if not paths:
        return None
    try:
        return [Path(path).read_bytes() for path in paths]
    except Exception:
        _log.exception("Apple root certificate load failed")
        return None


def _apple_verifier():
    environment = _apple_environment()
    root_certificates = _apple_root_certificates()
    if environment is None or not root_certificates or not _settings.apple_bundle_id:
        return None
    try:
        from appstoreserverlibrary.signed_data_verifier import SignedDataVerifier

        return SignedDataVerifier(
            root_certificates=root_certificates,
            enable_online_checks=True,
            environment=environment,
            bundle_id=_settings.apple_bundle_id,
            app_apple_id=_settings.apple_app_apple_id,
        )
    except Exception:
        _log.exception("Apple signed data verifier init failed")
        return None


def _apple_api_client():
    if not (
        _settings.apple_issuer_id
        and _settings.apple_key_id
        and _settings.apple_private_key_path
        and _settings.apple_bundle_id
    ):
        return None
    environment = _apple_environment()
    if environment is None:
        return None
    try:
        from appstoreserverlibrary.api_client import AppStoreServerAPIClient

        signing_key = Path(_settings.apple_private_key_path).read_bytes()
        return AppStoreServerAPIClient(
            signing_key=signing_key,
            key_id=_settings.apple_key_id,
            issuer_id=_settings.apple_issuer_id,
            bundle_id=_settings.apple_bundle_id,
            environment=environment,
        )
    except Exception:
        _log.exception("Apple App Store Server API client init failed")
        return None


def _iter_items(value: object | None) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return list(value) if isinstance(value, tuple | set) else [value]


def _prefer_apple_subscription(current: dict | None, candidate: dict) -> dict:
    if current is None:
        return candidate
    current_expiry = current.get("expiry")
    candidate_expiry = candidate.get("expiry")
    if candidate_expiry and (not current_expiry or candidate_expiry > current_expiry):
        return candidate
    if candidate_expiry == current_expiry and candidate.get("active") and not current.get("active"):
        return candidate
    return current


def _latest_apple_subscription(verifier, client, any_transaction_id: str, product_id: str) -> dict | None:
    response = client.get_all_subscription_statuses(any_transaction_id=any_transaction_id)
    best = None
    for subscription_group in _iter_items(_field(response, "data")):
        for last_transaction in _iter_items(_field(subscription_group, "lastTransactions")):
            signed_transaction = _field(last_transaction, "signedTransactionInfo")
            if not signed_transaction:
                continue
            transaction = verifier.verify_and_decode_signed_transaction(signed_transaction)
            signed_renewal = _field(last_transaction, "signedRenewalInfo")
            renewal = verifier.verify_and_decode_renewal_info(signed_renewal) if signed_renewal else None
            try:
                candidate = normalize_apple_subscription(transaction, renewal, product_id)
            except ValueError:
                continue
            best = _prefer_apple_subscription(best, candidate)
    return best


def verify_apple_subscription(
    *,
    signed_transaction_info: str | None,
    transaction_id: str | None,
    product_id: str,
) -> dict | None:
    """Apple signed transaction を検証し、正規化済み購読状態を返す。"""
    verifier = _apple_verifier()
    if verifier is None or not (signed_transaction_info or transaction_id):
        return None

    client = _apple_api_client()
    try:
        if signed_transaction_info:
            transaction = verifier.verify_and_decode_signed_transaction(signed_transaction_info)
        elif client is not None:
            response = client.get_transaction_info(transaction_id)
            transaction = verifier.verify_and_decode_signed_transaction(_field(response, "signedTransactionInfo"))
        else:
            return None

        result = normalize_apple_subscription(transaction, renewal_info=None, expected_product_id=product_id)
        if client is not None:
            latest = _latest_apple_subscription(verifier, client, result["purchase_token"], product_id)
            if latest is not None:
                return latest
        return result
    except ValueError:
        _log.exception("Apple subscription payload rejected")
        return None
    except Exception:
        _log.exception("Apple subscription verify failed")
        return None


def _apple_enum_value(value: object | None) -> str:
    raw = getattr(value, "value", value)
    return str(raw or "").strip()


def verify_apple_notification(*, signed_payload: str, product_id: str) -> dict | None:
    """App Store Server Notifications V2 を検証し、購読状態へ正規化する。"""
    verifier = _apple_verifier()
    if verifier is None or not signed_payload:
        return None

    try:
        notification = verifier.verify_and_decode_notification(signed_payload)
        notification_type = _apple_enum_value(
            _field(notification, "notificationType")
            or _field(notification, "rawNotificationType")
        ).upper()
        subtype = _apple_enum_value(
            _field(notification, "subtype") or _field(notification, "rawSubtype")
        ).upper()
        if notification_type == "TEST":
            return {"test": True, "notification_type": notification_type, "subtype": subtype}

        data = _field(notification, "data")
        signed_transaction = _field(data, "signedTransactionInfo")
        if not signed_transaction:
            raise ValueError("Apple notification transaction is missing")
        transaction = verifier.verify_and_decode_signed_transaction(signed_transaction)

        signed_renewal = _field(data, "signedRenewalInfo")
        renewal_info = (
            verifier.verify_and_decode_renewal_info(signed_renewal)
            if signed_renewal
            else None
        )
        result = normalize_apple_subscription(transaction, renewal_info, product_id)

        if notification_type in {"GRACE_PERIOD_EXPIRED", "EXPIRED"}:
            result["active"] = False
            result["state"] = "expired"
        elif notification_type in {"REFUND", "REVOKE"} or _field(transaction, "revocationDate"):
            result["active"] = False
            result["state"] = "revoked"
        elif notification_type == "DID_CHANGE_RENEWAL_STATUS" and result["active"]:
            if subtype == "AUTO_RENEW_DISABLED":
                result["state"] = "canceled_until_expiry"
            elif subtype == "AUTO_RENEW_ENABLED":
                result["state"] = "active"
        elif notification_type in {"SUBSCRIBED", "DID_RENEW"} and result["active"]:
            result["state"] = "active"
        elif notification_type == "DID_FAIL_TO_RENEW" and result["state"] != "grace":
            result["state"] = "did_fail_to_renew"
        elif notification_type not in {
            "SUBSCRIBED",
            "DID_RENEW",
            "DID_CHANGE_RENEWAL_STATUS",
            "DID_FAIL_TO_RENEW",
        } and result["active"]:
            result["state"] = (notification_type or "unknown").lower()

        result.update(
            test=False,
            notification_type=notification_type,
            subtype=subtype,
        )
        return result
    except ValueError:
        _log.exception("Apple notification payload rejected")
        return None
    except Exception:
        _log.exception("Apple notification verify failed")
        return None


def cancel_google_subscription(purchase_token: str, product_id: str) -> bool:
    """Play 定期購入の自動更新を停止する(返金はしない)。退会時に呼ぶ。ブロッキングなので
    呼び出し側は run_in_threadpool で。成功なら True。課金未設定/権限不足/既に終了済み/失敗は
    False(退会自体はブロックしない)。"""
    svc = _publisher()
    if svc is None:
        return False
    try:
        svc.purchases().subscriptions().cancel(
            packageName=_settings.play_package_name,
            subscriptionId=product_id,
            token=purchase_token,
        ).execute()
        return True
    except Exception:
        _log.exception("Play subscription cancel failed")
        return False
