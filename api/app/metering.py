"""月間の解析枚数メータリング。firm 単位で当月(暦月)に解析した領収書を数える。

無料(free=30)・サブスク(pro=500)の上限判定に使う。会社(business)は無制限。
カウント対象 = doc_type='receipt'(クレジット明細は対象外)・削除以外・当月 created_at。
"""
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import ApprovalStatus, Receipt


def _month_start() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def monthly_usage(session: AsyncSession, firm_id: UUID) -> int:
    """当月に解析した領収書数(RLSスコープ内。個人=自分の分)。"""
    n = await session.scalar(
        select(func.count(Receipt.id)).where(
            Receipt.firm_id == firm_id,
            Receipt.doc_type == "receipt",
            Receipt.approval_status != ApprovalStatus.deleted.value,
            Receipt.created_at >= _month_start(),
        )
    )
    return int(n or 0)
