"""領収書の処理レーン判定。

ルール: 取り込んだ人(created_by)が、その顧問先で **一般社員(client_user)** なら
**expense**(立替経費)、それ以外(経理/管理者/事務所職員/不明)は **company**(会社経費)。

メールはアカウントの connected_by、撮影は撮った本人が created_by。memberships は
RLS で「同一firmなら読める」ので、ownerワーカーでも管理者のRLSセッションでも引ける。
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Membership, ReceiptLane, Role


async def resolve_lane(session: AsyncSession, user_id: UUID | None, client_id: UUID) -> str:
    if user_id is None:
        return ReceiptLane.company.value
    role = await session.scalar(
        select(Membership.role).where(
            Membership.user_id == user_id,
            Membership.client_id == client_id,
        )
    )
    return ReceiptLane.expense.value if role == Role.client_user.value else ReceiptLane.company.value
