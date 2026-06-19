"""FCM プッシュ通知(Phase D)。Firebase Admin SDK で送信する。

- 宛先トークンは **owner 接続(RLSバイパス)** で device_tokens から引く。申請者→承認者の通知など、
  RLS では読めない他ユーザーのトークンにも送るため。
- 鍵(settings.fcm_credentials_path)が未設定なら全て no-op(通知無効)。
- 送信は投げっぱなし(`fire`)でレスポンスをブロックしない。失敗は飲み込む(通知失敗で業務を止めない)。
"""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.concurrency import run_in_threadpool

from .config import get_settings
from .models import DeviceToken

_log = logging.getLogger("fcm")
_settings = get_settings()
# Owner 接続(worker と同じ)。RLS をバイパスして任意ユーザーのトークンを読む。
_engine = create_async_engine(_settings.database_url, pool_pre_ping=True)
_Session = async_sessionmaker(_engine, expire_on_commit=False)

_app = None  # firebase_admin app(遅延初期化)
_tasks: set = set()


def _ensure_app():
    global _app
    if _app is not None:
        return _app
    path = _settings.fcm_credentials_path
    if not path:
        return None
    try:
        import firebase_admin
        from firebase_admin import credentials

        _app = firebase_admin.get_app() if firebase_admin._apps else firebase_admin.initialize_app(
            credentials.Certificate(path)
        )
        return _app
    except Exception:
        _log.exception("FCM init failed (path=%s)", path)
        return None


def _send(tokens: list[str], title: str, body: str, data: dict) -> int:
    from firebase_admin import messaging

    msg = messaging.MulticastMessage(
        tokens=tokens,
        notification=messaging.Notification(title=title, body=body),
        data={k: str(v) for k, v in (data or {}).items()},
    )
    resp = messaging.send_each_for_multicast(msg)
    return resp.success_count


async def notify_users(user_ids, title: str, body: str, data: dict | None = None) -> int:
    """対象ユーザーの全FCMトークンへ通知。鍵未設定/トークン無し/失敗時は 0。例外は外に出さない。"""
    uids = [u for u in set(user_ids) if u]
    if not uids:
        return 0
    if _ensure_app() is None:
        return 0  # 鍵未設定 = 通知無効
    try:
        async with _Session() as session:
            rows = await session.scalars(select(DeviceToken.token).where(DeviceToken.user_id.in_(uids)))
            tokens = [t for t in rows if t]
        if not tokens:
            return 0
        return await run_in_threadpool(_send, tokens, title, body, data or {})
    except Exception:
        _log.exception("FCM notify failed")
        return 0


def fire(coro) -> None:
    """通知を投げっぱなしで実行(レスポンスをブロックしない)。GC されないよう参照を保持。"""
    try:
        t = asyncio.create_task(coro)
        _tasks.add(t)
        t.add_done_callback(_tasks.discard)
    except RuntimeError:
        # 実行中ループが無い等。通知は捨てる(業務は継続)。
        coro.close()
