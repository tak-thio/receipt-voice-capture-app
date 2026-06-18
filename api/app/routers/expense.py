"""経費精算(expense claims): 申請→承認/否認/再提出/取下げ。支払い実行はしない。

既存の取込済み領収書(receipts)を束ねて1申請にする。承認者=顧問先の管理者/経理(自己承認不可)。
承認時に任意で「仕訳データ作成」(束ねた領収書を journalized + 既定貸方科目を付与)。
データ可視性は RLS(一般社員=自分の申請のみ / 管理者・経理・職員=全件)。各操作は監査ログに記録。
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import audit
from ..db import get_session
from ..deps import Principal, get_principal
from ..models import (
    Client,
    ExpenseClaim,
    ExpenseClaimItem,
    Receipt,
    ReceiptFile,
    Role,
    User,
)

router = APIRouter(prefix="/expense", tags=["expense"])

_CLIENT_ROLES = {Role.client_admin.value, Role.client_accountant.value, Role.client_user.value}
_APPROVER_ROLES = {Role.client_admin.value, Role.client_accountant.value}
_EDITABLE_STATUSES = {"draft", "rejected"}  # 申請者が中身を直せる状態


class ClaimIn(BaseModel):
    title: str | None = None
    receipt_ids: list[UUID] = []


class ApproveBody(BaseModel):
    journalize: bool = False  # 「支払いの仕訳データを作成する」チェックボックス


class RejectBody(BaseModel):
    reason: str | None = None


def _is_member(principal: Principal, client_id: UUID) -> bool:
    return any(m.client_id == client_id and m.role in _CLIENT_ROLES for m in principal.memberships)


def _can_approve(principal: Principal, client_id: UUID) -> bool:
    return any(m.client_id == client_id and m.role in _APPROVER_ROLES for m in principal.memberships)


async def _require_expense_enabled(session: AsyncSession, client_id: UUID) -> Client:
    client = await session.get(Client, client_id)  # RLS-scoped
    if not client:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client not found")
    if not client.expense_enabled:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "この顧問先では経費精算が無効です")
    return client


async def _names(session: AsyncSession, uids) -> dict:
    uids = {u for u in uids if u}
    if not uids:
        return {}
    rows = await session.execute(select(User.id, User.name).where(User.id.in_(uids)))
    return {uid: nm for uid, nm in rows.all()}


async def _items_of(session: AsyncSession, claim_id: UUID) -> list[ExpenseClaimItem]:
    return list(await session.scalars(select(ExpenseClaimItem).where(ExpenseClaimItem.claim_id == claim_id)))


async def _receipts_map(session: AsyncSession, receipt_ids) -> dict:
    ids = {r for r in receipt_ids}
    if not ids:
        return {}
    rows = await session.scalars(select(Receipt).where(Receipt.id.in_(ids)))
    return {r.id: r for r in rows}


def _claim_dict(c: ExpenseClaim, items, rmap, names) -> dict:
    rs = [rmap.get(i.receipt_id) for i in items]
    total = sum((r.amount_jpy or 0) for r in rs if r is not None)
    return {
        "id": str(c.id),
        "title": c.title,
        "status": c.status,
        "applicant": names.get(c.applicant_user_id),
        "applicant_user_id": str(c.applicant_user_id) if c.applicant_user_id else None,
        "approver": names.get(c.approver_user_id),
        "reject_reason": c.reject_reason,
        "decided_at": c.decided_at.isoformat() if c.decided_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "item_count": len(items),
        "total_jpy": total,
        "items": [
            {
                "receipt_id": str(i.receipt_id),
                "vendor": (rmap.get(i.receipt_id).vendor if rmap.get(i.receipt_id) else None),
                "amount_jpy": (rmap.get(i.receipt_id).amount_jpy if rmap.get(i.receipt_id) else None),
                "date": (
                    rmap[i.receipt_id].captured_at.date().isoformat()
                    if rmap.get(i.receipt_id) and rmap[i.receipt_id].captured_at
                    else None
                ),
            }
            for i in items
        ],
    }


@router.get("/claims")
async def list_claims(
    client_id: UUID,
    status_filter: str | None = None,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """申請一覧。RLSにより一般社員は自分の分のみ、管理者/経理/職員は全件。status で絞り込み。"""
    stmt = select(ExpenseClaim).where(ExpenseClaim.client_id == client_id)
    if status_filter:
        stmt = stmt.where(ExpenseClaim.status == status_filter)
    claims = list(await session.scalars(stmt.order_by(ExpenseClaim.created_at.desc())))
    all_items: dict = {}
    for c in claims:
        all_items[c.id] = await _items_of(session, c.id)
    rid = {i.receipt_id for items in all_items.values() for i in items}
    rmap = await _receipts_map(session, rid)
    names = await _names(session, [c.applicant_user_id for c in claims] + [c.approver_user_id for c in claims])
    return [_claim_dict(c, all_items[c.id], rmap, names) for c in claims]


@router.post("/claims", status_code=201)
async def create_claim(
    client_id: UUID,
    body: ClaimIn,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    await _require_expense_enabled(session, client_id)
    if not _is_member(principal, client_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "この顧問先のメンバーのみ申請できます")
    claim = ExpenseClaim(
        firm_id=(await session.get(Client, client_id)).firm_id,
        client_id=client_id,
        applicant_user_id=principal.user.id,
        title=body.title,
        status="draft",
    )
    session.add(claim)
    await session.flush()
    await _set_items(session, claim, body.receipt_ids, principal)
    await session.flush()
    items = await _items_of(session, claim.id)
    rmap = await _receipts_map(session, [i.receipt_id for i in items])
    names = await _names(session, [claim.applicant_user_id])
    return _claim_dict(claim, items, rmap, names)


async def _set_items(session: AsyncSession, claim: ExpenseClaim, receipt_ids, principal: Principal) -> None:
    """申請に束ねる領収書を入れ替える。RLSで見えない(=権限外)領収書は弾く。"""
    existing = await _items_of(session, claim.id)
    for i in existing:
        await session.delete(i)
    await session.flush()
    seen = set()
    for rid in receipt_ids:
        if rid in seen:
            continue
        seen.add(rid)
        r = await session.get(Receipt, rid)  # RLS-scoped: 見えない領収書は None
        if r is None or r.client_id != claim.client_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"領収書を束ねられません: {rid}")
        session.add(
            ExpenseClaimItem(
                claim_id=claim.id,
                receipt_id=rid,
                client_id=claim.client_id,
                applicant_user_id=claim.applicant_user_id,
            )
        )


async def _get_owned_claim(session: AsyncSession, claim_id: UUID) -> ExpenseClaim:
    claim = await session.get(ExpenseClaim, claim_id)  # RLS-scoped
    if not claim:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "claim not found")
    return claim


@router.get("/claims/{claim_id}")
async def get_claim(
    claim_id: UUID,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    claim = await _get_owned_claim(session, claim_id)
    items = await _items_of(session, claim.id)
    rmap = await _receipts_map(session, [i.receipt_id for i in items])
    names = await _names(session, [claim.applicant_user_id, claim.approver_user_id])
    return _claim_dict(claim, items, rmap, names)


@router.patch("/claims/{claim_id}")
async def update_claim(
    claim_id: UUID,
    body: ClaimIn,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """下書き/否認差し戻しの中身を編集(申請者本人のみ)。"""
    claim = await _get_owned_claim(session, claim_id)
    if claim.applicant_user_id != principal.user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "申請者本人のみ編集できます")
    if claim.status not in _EDITABLE_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "この状態では編集できません")
    claim.title = body.title
    await _set_items(session, claim, body.receipt_ids, principal)
    await session.flush()
    items = await _items_of(session, claim.id)
    rmap = await _receipts_map(session, [i.receipt_id for i in items])
    names = await _names(session, [claim.applicant_user_id, claim.approver_user_id])
    return _claim_dict(claim, items, rmap, names)


async def _validate_submittable(session: AsyncSession, claim: ExpenseClaim, items) -> None:
    """提出時チェック: 1件以上 + 各領収書に添付があり金額・日付が揃っていること(整合)。"""
    if not items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "領収書が1件もありません")
    rmap = await _receipts_map(session, [i.receipt_id for i in items])
    problems = []
    for i in items:
        r = rmap.get(i.receipt_id)
        if r is None:
            problems.append("領収書が見つかりません")
            continue
        attach = await session.scalar(
            select(ReceiptFile.id).where(ReceiptFile.receipt_id == r.id, ReceiptFile.kind == "capture")
        )
        if attach is None:
            problems.append(f"{r.vendor or '(無題)'}: 添付がありません")
        if r.amount_jpy is None:
            problems.append(f"{r.vendor or '(無題)'}: 金額が未入力")
        if r.captured_at is None:
            problems.append(f"{r.vendor or '(無題)'}: 日付が未入力")
    if problems:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "提出できません: " + " / ".join(problems[:8]))


@router.post("/claims/{claim_id}/submit")
async def submit_claim(
    claim_id: UUID,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    claim = await _get_owned_claim(session, claim_id)
    if claim.applicant_user_id != principal.user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "申請者本人のみ提出できます")
    if claim.status not in _EDITABLE_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "この状態では提出できません")
    items = await _items_of(session, claim.id)
    await _validate_submittable(session, claim, items)
    prev = claim.status
    claim.status = "submitted"
    claim.reject_reason = None
    await audit.log_audit(
        session, firm_id=claim.firm_id, client_id=claim.client_id, actor_user_id=principal.user.id,
        action="resubmitted" if prev == "rejected" else "submitted",
        target_type="expense_claim", target_id=claim.id, summary=claim.title,
    )
    await session.flush()
    return {"id": str(claim.id), "status": claim.status}


@router.post("/claims/{claim_id}/withdraw")
async def withdraw_claim(
    claim_id: UUID,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    claim = await _get_owned_claim(session, claim_id)
    if claim.applicant_user_id != principal.user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "申請者本人のみ取り下げできます")
    if claim.status not in {"draft", "submitted", "rejected"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "この状態では取り下げできません")
    claim.status = "withdrawn"
    await audit.log_audit(
        session, firm_id=claim.firm_id, client_id=claim.client_id, actor_user_id=principal.user.id,
        action="withdrawn", target_type="expense_claim", target_id=claim.id, summary=claim.title,
    )
    await session.flush()
    return {"id": str(claim.id), "status": claim.status}


@router.post("/claims/{claim_id}/approve")
async def approve_claim(
    claim_id: UUID,
    body: ApproveBody,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    claim = await _get_owned_claim(session, claim_id)
    if not _can_approve(principal, claim.client_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "承認は顧問先の管理者/経理のみ可能です")
    if claim.applicant_user_id == principal.user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "自分の申請は承認できません")
    if claim.status != "submitted":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "申請中のものだけ承認できます")
    claim.status = "approved"
    claim.approver_user_id = principal.user.id
    claim.decided_at = datetime.now(timezone.utc)

    journalized = 0
    if body.journalize:
        client = await session.get(Client, claim.client_id)
        credit = client.expense_credit_account_title_id if client else None
        items = await _items_of(session, claim.id)
        rmap = await _receipts_map(session, [i.receipt_id for i in items])
        for r in rmap.values():
            if r.journalized_at is not None:
                continue
            if credit and r.credit_account_title_id is None:
                r.credit_account_title_id = credit
            r.journalized_at = datetime.now(timezone.utc)
            r.journal_hold = False
            journalized += 1
            await audit.log_audit(
                session, firm_id=r.firm_id, client_id=r.client_id, actor_user_id=principal.user.id,
                action="journalized", target_type="receipt", target_id=r.id, summary="経費精算の承認で仕訳",
            )

    await audit.log_audit(
        session, firm_id=claim.firm_id, client_id=claim.client_id, actor_user_id=principal.user.id,
        action="approved", target_type="expense_claim", target_id=claim.id,
        summary=f"{claim.title or ''} (仕訳作成{journalized}件)" if body.journalize else claim.title,
    )
    await session.flush()
    return {"id": str(claim.id), "status": claim.status, "journalized": journalized}


@router.post("/claims/{claim_id}/reject")
async def reject_claim(
    claim_id: UUID,
    body: RejectBody,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    claim = await _get_owned_claim(session, claim_id)
    if not _can_approve(principal, claim.client_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "否認は顧問先の管理者/経理のみ可能です")
    if claim.applicant_user_id == principal.user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "自分の申請は否認できません")
    if claim.status != "submitted":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "申請中のものだけ否認できます")
    claim.status = "rejected"
    claim.approver_user_id = principal.user.id
    claim.decided_at = datetime.now(timezone.utc)
    claim.reject_reason = body.reason
    await audit.log_audit(
        session, firm_id=claim.firm_id, client_id=claim.client_id, actor_user_id=principal.user.id,
        action="rejected", target_type="expense_claim", target_id=claim.id, summary=body.reason or claim.title,
    )
    await session.flush()
    return {"id": str(claim.id), "status": claim.status}
