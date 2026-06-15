"""仕分け (journaling) engine — ported & adapted from receipt-app app/journal.py.

設計方針（素直・推測しない）:
- 記録される取引先(partner)は **完全一致のみ**で引き当てる。外れたら空のまま
  （あいまい一致やキーワード辞書での推測はしない。疑問は領収書の原本で確認する）。
  キー優先順: 1) T番号(登録番号)一致 → 2) 学習エイリアス(正規化vendor完全一致)
  → 3) 取引先名の完全一致(正規化)。
- 勘定科目は「自分が過去に確定した」学習ルール(vendor完全一致)＋取引先履歴から
  **サジェスト**するのみ（あくまで助言。確定は人が行う）。
"""

from __future__ import annotations

import re
from collections import Counter
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import JournalRule, Partner, PartnerAlias, Receipt


def normalize_vendor(vendor: str | None) -> str:
    return re.sub(r"\s+", " ", (vendor or "").strip()).lower()


# --- partner lookup (完全一致のみ) -----------------------------------------

async def _lookup_partner(db: AsyncSession, receipt: Receipt) -> UUID | None:
    """取引先を完全一致だけで引き当てる（推測しない）。Client-scoped。
    1) T番号一致（最も確実） 2) 学習エイリアス(正規化vendor完全一致) 3) 名称完全一致。"""
    # 1) インボイス登録番号(T番号)が完全一致する取引先。
    tnum = (receipt.t_number or "").strip()
    if tnum:
        pid = await db.scalar(
            select(Partner.id).where(
                Partner.client_id == receipt.client_id,
                Partner.active.is_(True),
                Partner.t_number == tnum,
            )
        )
        if pid is not None:
            return pid

    key = normalize_vendor(receipt.vendor)
    if not key:
        return None

    # 2) 学習エイリアス（過去の確定: 正規化vendor の完全一致）。
    alias = await db.scalar(
        select(PartnerAlias.partner_id).where(
            PartnerAlias.client_id == receipt.client_id,
            PartnerAlias.raw_vendor == key,
        )
    )
    if alias is not None:
        return alias

    # 3) 取引先名が完全一致（正規化後）。部分一致・あいまい一致はしない。
    for p in await db.scalars(
        select(Partner).where(Partner.client_id == receipt.client_id, Partner.active.is_(True))
    ):
        if normalize_vendor(p.name) == key:
            return p.id
    return None


async def exact_partner_id(db: AsyncSession, receipt: Receipt) -> UUID | None:
    """OCR直後など、完全一致で取引先を自動引当するための公開ヘルパー。"""
    return await _lookup_partner(db, receipt)


async def partner_id_for(
    db: AsyncSession, client_id: UUID, name: str | None, t_number: str | None = None
) -> UUID | None:
    """任意の取引先名(自由入力)を、マスタへ完全一致だけで引き当てる（推測しない）。
    優先順: T番号一致 → 学習エイリアス(正規化完全一致) → 取引先名の完全一致。無ければ None。"""
    tnum = (t_number or "").strip()
    if tnum:
        pid = await db.scalar(
            select(Partner.id).where(
                Partner.client_id == client_id,
                Partner.active.is_(True),
                Partner.t_number == tnum,
            )
        )
        if pid is not None:
            return pid
    key = normalize_vendor(name)
    if not key:
        return None
    alias = await db.scalar(
        select(PartnerAlias.partner_id).where(
            PartnerAlias.client_id == client_id,
            PartnerAlias.raw_vendor == key,
        )
    )
    if alias is not None:
        return alias
    for p in await db.scalars(
        select(Partner).where(Partner.client_id == client_id, Partner.active.is_(True))
    ):
        if normalize_vendor(p.name) == key:
            return p.id
    return None


# --- account suggestion (rule > history > dictionary) ----------------------

async def _rule_for_vendor(db: AsyncSession, receipt: Receipt) -> JournalRule | None:
    key = normalize_vendor(receipt.vendor)
    if not key:
        return None
    return await db.scalar(
        select(JournalRule)
        .where(JournalRule.client_id == receipt.client_id, JournalRule.vendor_key == key)
        .order_by(JournalRule.hit_count.desc())
    )


async def _account_from_history(
    db: AsyncSession, client_id: UUID, partner_id: UUID | None
) -> UUID | None:
    if not partner_id:
        return None
    rows = list(
        await db.scalars(
            select(Receipt.account_title_id).where(
                Receipt.client_id == client_id,
                Receipt.partner_id == partner_id,
                Receipt.journalized_at.is_not(None),
                Receipt.account_title_id.is_not(None),
            )
        )
    )
    return Counter(rows).most_common(1)[0][0] if rows else None


async def suggest(db: AsyncSession, receipt: Receipt) -> dict:
    """Suggest {partner_id, account_title_id, sub_account_id}.

    取引先は完全一致のみ（推測しない）。勘定科目は自分の学習ルール(vendor完全一致)＞
    取引先履歴 の順でサジェスト（助言のみ）。キーワード辞書での推測はしない。"""
    partner_id = await _lookup_partner(db, receipt)
    rule = await _rule_for_vendor(db, receipt)

    if rule and rule.account_title_id:
        account_title_id = rule.account_title_id
        sub_account_id = rule.sub_account_id
    else:
        account_title_id = await _account_from_history(db, receipt.client_id, partner_id)
        sub_account_id = None

    return {
        "partner_id": partner_id,
        "account_title_id": account_title_id,
        "sub_account_id": sub_account_id,
    }


# --- learning (on 確定) -----------------------------------------------------

async def learn(
    db: AsyncSession,
    receipt: Receipt,
    *,
    account_title_id: UUID | None,
    sub_account_id: UUID | None,
    partner_id: UUID | None,
) -> None:
    """Upsert a vendor -> account rule and the partner alias on every confirm."""
    await learn_partner(db, receipt, partner_id)

    key = normalize_vendor(receipt.vendor)
    if not key or account_title_id is None:
        return
    rule = await db.scalar(
        select(JournalRule).where(
            JournalRule.client_id == receipt.client_id, JournalRule.vendor_key == key
        )
    )
    if rule is None:
        rule = JournalRule(client_id=receipt.client_id, vendor_key=key, hit_count=0)
        db.add(rule)
    rule.account_title_id = account_title_id
    rule.sub_account_id = sub_account_id
    rule.partner_id = partner_id
    rule.hit_count = (rule.hit_count or 0) + 1


async def learn_partner(db: AsyncSession, receipt: Receipt, partner_id: UUID | None) -> None:
    """Learn vendor-string -> partner (client-scoped alias upsert)."""
    if partner_id is None:
        return
    key = normalize_vendor(receipt.vendor)
    if not key:
        return
    alias = await db.scalar(
        select(PartnerAlias).where(
            PartnerAlias.client_id == receipt.client_id,
            PartnerAlias.raw_vendor == key,
        )
    )
    if alias is None:
        db.add(PartnerAlias(client_id=receipt.client_id, raw_vendor=key, partner_id=partner_id))
    else:
        alias.partner_id = partner_id
