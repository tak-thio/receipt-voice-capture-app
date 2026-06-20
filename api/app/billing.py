"""アプリ内課金(IAP)の購入検証。Android=Google Play Developer API。

サービスアカウント鍵(play_service_account_path)が未設定なら検証は無効(None)。
purchase_token を Play に問い合わせ、購読状態と期限を返す。ブロッキングなので呼び出し側は
run_in_threadpool で呼ぶこと。更新/解約の反映はストア通知(RTDN)で別途行う想定。
"""
from __future__ import annotations

import logging
from datetime import datetime

from .config import get_settings

_log = logging.getLogger("billing")
_settings = get_settings()
# 課金が有効とみなす購読状態。
_ACTIVE_STATES = {"SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"}


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
