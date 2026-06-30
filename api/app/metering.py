"""解析枚数メータリング。

- monthly_usage          : firm 単位で当月(暦月)に解析した領収書数(RLSスコープ内)。
                           無料(free=10)・サブスク(pro=500)の月間上限判定に使う。会社は無制限。
- free_daily_usage_global: 無料プラン全体(全フリーユーザー合計)の本日(JST)の解析枚数。
                           運営の Gemini 鍵のコスト保護(FREE_DAILY_GLOBAL_CAP)に使う。
カウント対象 = doc_type='receipt'(クレジット明細は対象外)・削除以外。
"""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import plans
from .db import OwnerSessionLocal
from .models import ApprovalStatus, Firm, Receipt

# 日本は常に UTC+9(DSTなし)。「1日」は JST の暦日で数える。
_JST = timezone(timedelta(hours=9))


def _month_start() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _today_start_utc() -> datetime:
    """本日(JST)の0時を UTC で返す。"""
    start_jst = datetime.now(_JST).replace(hour=0, minute=0, second=0, microsecond=0)
    return start_jst.astimezone(timezone.utc)


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


async def free_daily_usage_global() -> int:
    """全フリーユーザー合計の本日(JST)の解析枚数。全テナント横断なので owner 接続(RLSバイパス)で数える。"""
    async with OwnerSessionLocal() as s:
        n = await s.scalar(
            select(func.count(Receipt.id))
            .select_from(Receipt)
            .join(Firm, Firm.id == Receipt.firm_id)
            .where(
                Firm.plan == plans.PLAN_FREE,
                Receipt.doc_type == "receipt",
                Receipt.approval_status != ApprovalStatus.deleted.value,
                Receipt.created_at >= _today_start_utc(),
            )
        )
    return int(n or 0)
