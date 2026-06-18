"""監査ログ(append-only)。電子帳簿保存法の訂正削除履歴＋各操作の証跡を記録する。

呼び出し側のトランザクションに add するだけ(commit は呼び出し側)。アプリDBロールには
INSERT/SELECT のみ付与しており、UPDATE/DELETE はできない(=改ざん防止)。
"""
from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from .models import AuditLog


def jsonable(v):
    """監査ログの before/after 用に JSON 化可能な値へ。UUID/日時は文字列に。"""
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, UUID):
        return str(v)
    return v


async def log_audit(
    session: AsyncSession,
    *,
    firm_id: UUID,
    client_id: UUID | None,
    actor_user_id: UUID | None,
    action: str,
    target_type: str,
    target_id: UUID,
    summary: str | None = None,
    changes: dict | None = None,
) -> None:
    session.add(
        AuditLog(
            firm_id=firm_id,
            client_id=client_id,
            actor_user_id=actor_user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            summary=summary,
            changes=changes or None,
        )
    )
