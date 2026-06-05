"""仕分け (journaling) engine — ported & adapted from receipt-app app/journal.py.

Learning (per 顧問先 / client, rule-based — no ML):
1. vendor -> account RULE (journal_rules.vendor_key): learned on every 確定;
   exact normalized-vendor match is the strongest suggestion.
2. partner alias (vendor -> partner) + account from that partner's history.
3. cold-start dictionary (keyword -> account-category name) for receipts with
   no learned rule yet.
Priority for the account: rule > partner-history > dictionary.
"""

from __future__ import annotations

import re
from collections import Counter
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import dictionaries
from .models import AccountTitle, JournalRule, Partner, PartnerAlias, Receipt


def normalize_vendor(vendor: str | None) -> str:
    return re.sub(r"\s+", " ", (vendor or "").strip()).lower()


# --- partner lookup --------------------------------------------------------

async def _lookup_partner(db: AsyncSession, receipt: Receipt) -> UUID | None:
    """1) learned alias (exact vendor) 2) fuzzy partner-name match. Client-scoped."""
    key = normalize_vendor(receipt.vendor)
    if key:
        alias = await db.scalar(
            select(PartnerAlias).where(
                PartnerAlias.client_id == receipt.client_id,
                PartnerAlias.raw_vendor == key,
            )
        )
        if alias is not None:
            return alias.partner_id

    partners = list(
        await db.scalars(
            select(Partner).where(
                Partner.client_id == receipt.client_id, Partner.active.is_(True)
            )
        )
    )
    if key:
        best_id: UUID | None = None
        best_len = 0
        for p in partners:
            pname = normalize_vendor(p.name)
            if len(pname) < 2:
                continue
            if (pname == key or pname in key or key in pname) and len(pname) > best_len:
                best_id, best_len = p.id, len(pname)
        return best_id
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


async def _account_from_dictionary(db: AsyncSession, receipt: Receipt) -> UUID | None:
    """Keyword in vendor/OCR text -> category name -> the client's account_title."""
    text = " ".join(filter(None, [receipt.vendor, receipt.ocr_raw, receipt.stt_raw]))
    category = dictionaries.match_category(text)
    if not category:
        return None
    # Resolve to a client-visible account title with that name (client row first,
    # then the firm template). RLS already restricts to the principal's tenants.
    return await db.scalar(
        select(AccountTitle.id)
        .where(AccountTitle.name == category, AccountTitle.active.is_(True))
        .order_by(AccountTitle.client_id.is_(None))  # client-specific before template
    )


async def suggest(db: AsyncSession, receipt: Receipt) -> dict:
    """Suggest {partner_id, account_title_id, sub_account_id}."""
    rule = await _rule_for_vendor(db, receipt)
    partner_id = (rule.partner_id if rule else None) or await _lookup_partner(db, receipt)

    if rule and rule.account_title_id:
        account_title_id = rule.account_title_id
        sub_account_id = rule.sub_account_id
    else:
        account_title_id = await _account_from_history(db, receipt.client_id, partner_id)
        if account_title_id is None:
            account_title_id = await _account_from_dictionary(db, receipt)
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
