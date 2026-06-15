"""仕分け (journaling) queue, suggestion, and confirm/learn.

Engine lives in app/journaling.py. The queue returns rich items (with image and
a per-item suggestion) so the web app can render receipt-app's single-item
"拡大表示" journaling UX. Rows are RLS-isolated to the principal's tenants.
"""

from datetime import date, datetime, time, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import journaling
from ..db import get_session
from ..deps import Principal, get_principal
from ..models import AccountTitle, File, Partner, Receipt, ReceiptFile, User

router = APIRouter(prefix="/journal", tags=["journal"])


class Journalize(BaseModel):
    account_title_id: UUID | None = None  # 借方科目 (debit)
    credit_account_title_id: UUID | None = None  # 貸方科目 (credit)
    sub_account_id: UUID | None = None
    partner_id: UUID | None = None
    partner_name: str | None = None  # 取引先(自由入力)。マスタ完全一致なら自動で partner_id 引当
    # AI が誤読しうるので全項目を手修正できる。None の項目は据え置き。
    vendor: str | None = None  # 店舗名(支払先)
    date: str | None = None  # 領収書の日付 (YYYY-MM-DD)
    amount_jpy: int | None = None
    subtotal_jpy: int | None = None
    tax_jpy: int | None = None
    tax_10_jpy: int | None = None
    tax_8_jpy: int | None = None
    tax_mode: str | None = None  # inclusive / exclusive / unknown
    payment_method: str | None = None
    t_number: str | None = None  # インボイス番号
    description: str | None = None  # 摘要


def _parse_date(s: str | None) -> datetime | None:
    """YYYY-MM-DD 等を captured_at 用の datetime に。失敗時 None。"""
    if not s:
        return None
    txt = s.strip().replace("/", "-").replace(".", "-")[:10]
    try:
        return datetime.combine(date.fromisoformat(txt), time(0, 0), tzinfo=timezone.utc)
    except ValueError:
        return None


def _apply_journalize_fields(receipt: Receipt, body: "Journalize") -> None:
    """仕訳画面/元帳編集の入力値を receipt に反映（journalized_at/hold は触らない）。"""
    receipt.account_title_id = body.account_title_id
    receipt.credit_account_title_id = body.credit_account_title_id
    receipt.sub_account_id = body.sub_account_id
    receipt.partner_id = body.partner_id  # partner_name 指定時は呼び出し側で上書きする
    if body.partner_name is not None:
        receipt.partner_name = body.partner_name or None
    if body.vendor is not None:
        receipt.vendor = body.vendor or None
    parsed_date = _parse_date(body.date)
    if parsed_date is not None:
        receipt.captured_at = parsed_date
    if body.tax_mode is not None:
        receipt.tax_mode = body.tax_mode or None
    if body.payment_method is not None:
        receipt.payment_method = body.payment_method or None
    if body.amount_jpy is not None:
        receipt.amount_jpy = body.amount_jpy
    if body.subtotal_jpy is not None:
        receipt.subtotal_jpy = body.subtotal_jpy
    if body.tax_jpy is not None:
        receipt.tax_jpy = body.tax_jpy
    if body.tax_10_jpy is not None:
        receipt.tax_10_jpy = body.tax_10_jpy
    if body.tax_8_jpy is not None:
        receipt.tax_8_jpy = body.tax_8_jpy
    if body.t_number is not None:
        receipt.t_number = body.t_number or None
    if body.description is not None:
        receipt.description = body.description or None


async def _capture_file(session: AsyncSession, receipt_id: UUID) -> tuple[UUID | None, str | None]:
    """The captured file id + its mime (image/* or application/pdf) so the UI can
    pick <img> vs an <iframe> for PDFs."""
    row = (
        await session.execute(
            select(ReceiptFile.file_id, File.mime)
            .join(File, File.id == ReceiptFile.file_id)
            .where(ReceiptFile.receipt_id == receipt_id, ReceiptFile.kind == "capture")
        )
    ).first()
    return (row[0], row[1]) if row else (None, None)


async def _capture_files_map(session: AsyncSession, receipt_ids) -> dict:
    """receipt_id -> (file_id, mime) を1クエリでまとめて取得（一覧用）。"""
    ids = [rid for rid in receipt_ids]
    if not ids:
        return {}
    rows = await session.execute(
        select(ReceiptFile.receipt_id, ReceiptFile.file_id, File.mime)
        .join(File, File.id == ReceiptFile.file_id)
        .where(ReceiptFile.receipt_id.in_(ids), ReceiptFile.kind == "capture")
    )
    out: dict = {}
    for rid, fid, mime in rows.all():
        out.setdefault(rid, (fid, mime))
    return out


@router.get("/queue")
async def queue(
    client_id: UUID | None = None,
    view: str = "queue",  # "queue" (un-held) | "held"
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    held = view == "held"
    # 未処理（pending）のみ。否認/間違い/削除（approval_status）は除外される。
    conds = [Receipt.journalized_at.is_(None), Receipt.approval_status == "pending"]
    # 領収書とひも付け済みのカード明細行は二重計上になるため仕訳対象から除外
    # (本体は領収書側)。未ひも付けのカード行は対象に残る(領収書なしの支払)。
    conds.append(or_(Receipt.doc_type != "card_statement", Receipt.match_id.is_(None)))
    if client_id:
        conds.append(Receipt.client_id == client_id)

    rows = list(
        await session.scalars(
            select(Receipt)
            .where(*conds, Receipt.journal_hold.is_(held))
            .order_by(Receipt.captured_at.desc())
            .limit(50)
        )
    )
    total = await session.scalar(
        select(func.count(Receipt.id)).where(*conds, Receipt.journal_hold.is_(held))
    )
    held_count = await session.scalar(
        select(func.count(Receipt.id)).where(*conds, Receipt.journal_hold.is_(True))
    )

    ids = {r.created_by for r in rows if r.created_by}
    creators: dict = {}
    if ids:
        crows = await session.execute(
            select(User.id, User.name, User.email).where(User.id.in_(ids))
        )
        creators = {uid: (name or email) for uid, name, email in crows.all()}

    items = []
    for r in rows:
        suggestion = await journaling.suggest(session, r)
        img, img_mime = await _capture_file(session, r.id)
        items.append(
            {
                "id": str(r.id),
                "vendor": r.vendor,
                "created_by_name": creators.get(r.created_by),
                "amount_jpy": r.amount_jpy,
                "subtotal_jpy": r.subtotal_jpy,
                "tax_jpy": r.tax_jpy,
                "tax_10_jpy": r.tax_10_jpy,
                "tax_8_jpy": r.tax_8_jpy,
                "date": r.captured_at.date().isoformat() if r.captured_at else None,
                "source": r.source,
                "t_number": r.t_number,
                "description": r.description,
                "image_file_id": str(img) if img else None,
                "image_mime": img_mime,
                "tax_mode": r.tax_mode,
                "payment_method": r.payment_method,
                "account_title_id": str(r.account_title_id) if r.account_title_id else None,
                "credit_account_title_id": str(r.credit_account_title_id) if r.credit_account_title_id else None,
                "partner_id": str(r.partner_id) if r.partner_id else None,
                "partner_name": r.partner_name,
                "note_ids": r.note_ids or [],
                "suggestion": {
                    "account_title_id": str(suggestion["account_title_id"])
                    if suggestion["account_title_id"]
                    else None,
                    "partner_id": str(suggestion["partner_id"]) if suggestion["partner_id"] else None,
                },
            }
        )

    return {"items": items, "total": total or 0, "held_count": held_count or 0}


@router.get("/ledger")
async def ledger(
    client_id: UUID | None = None,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """仕分け済み(journalized)の仕訳一覧 = 元帳データ。借方/貸方/取引先名を解決して返す。
    RLS により、一般社員は自分の分のみ、管理者/経理/職員は全件が見える。"""
    stmt = select(Receipt).where(Receipt.journalized_at.is_not(None))
    # ひも付け済みカード明細行は二重計上防止のため元帳から除外(本体は領収書)。
    stmt = stmt.where(or_(Receipt.doc_type != "card_statement", Receipt.match_id.is_(None)))
    if client_id:
        stmt = stmt.where(Receipt.client_id == client_id)
    rows = list(await session.scalars(stmt.order_by(Receipt.journalized_at.desc()).limit(500)))

    title_ids = {r.account_title_id for r in rows if r.account_title_id} | {
        r.credit_account_title_id for r in rows if r.credit_account_title_id
    }
    titles: dict = {}
    if title_ids:
        trows = await session.execute(
            select(AccountTitle.id, AccountTitle.code, AccountTitle.name).where(AccountTitle.id.in_(title_ids))
        )
        titles = {tid: f"{code} {name}" for tid, code, name in trows.all()}
    partner_ids = {r.partner_id for r in rows if r.partner_id}
    partners: dict = {}
    if partner_ids:
        prows = await session.execute(select(Partner.id, Partner.name).where(Partner.id.in_(partner_ids)))
        partners = {pid: name for pid, name in prows.all()}
    images = await _capture_files_map(session, [r.id for r in rows])

    result = []
    for r in rows:
        img, img_mime = images.get(r.id, (None, None))
        result.append(
            {
                "id": str(r.id),
                "date": r.captured_at.date().isoformat() if r.captured_at else None,
                "journalized_at": r.journalized_at.isoformat() if r.journalized_at else None,
                "vendor": r.vendor,
                # 取引先: マスタ引当があればマスタ名、無ければ自由入力テキスト(空欄にしない)。
                "partner": partners.get(r.partner_id) or r.partner_name,
                "partner_name": r.partner_name,
                "debit": titles.get(r.account_title_id),
                "credit": titles.get(r.credit_account_title_id),
                "amount_jpy": r.amount_jpy,
                "tax_jpy": r.tax_jpy,
                "t_number": r.t_number,
                "description": r.description,
                # 直接編集（仕分けと同じ画面）用の生の値。
                "account_title_id": str(r.account_title_id) if r.account_title_id else None,
                "credit_account_title_id": str(r.credit_account_title_id) if r.credit_account_title_id else None,
                "partner_id": str(r.partner_id) if r.partner_id else None,
                "subtotal_jpy": r.subtotal_jpy,
                "tax_10_jpy": r.tax_10_jpy,
                "tax_8_jpy": r.tax_8_jpy,
                "tax_mode": r.tax_mode,
                "payment_method": r.payment_method,
                "source": r.source,
                "image_file_id": str(img) if img else None,
                "image_mime": img_mime,
                "note_ids": r.note_ids or [],
            }
        )
    return result


@router.get("/suggest/{receipt_id}")
async def suggest(
    receipt_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    receipt = await session.get(Receipt, receipt_id)
    if not receipt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "receipt not found")
    result = await journaling.suggest(session, receipt)
    return {k: (str(v) if v else None) for k, v in result.items()}


@router.post("/receipts/{receipt_id}")
async def journalize(
    receipt_id: UUID,
    body: Journalize,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """Confirm a receipt's categorization, mark journalized, and learn."""
    receipt = await session.get(Receipt, receipt_id)
    if not receipt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "receipt not found")

    _apply_journalize_fields(receipt, body)
    # 取引先(自由入力)はマスタに完全一致したときだけ partner_id を引当(推測しない)。
    if body.partner_name is not None:
        receipt.partner_id = await journaling.partner_id_for(
            session, receipt.client_id, receipt.partner_name, receipt.t_number
        )
    receipt.journalized_at = datetime.now(timezone.utc)
    receipt.journal_hold = False

    # Learn: vendor -> account rule + partner alias (per 顧問先).
    await journaling.learn(
        session,
        receipt,
        account_title_id=body.account_title_id,
        sub_account_id=body.sub_account_id,
        partner_id=receipt.partner_id,
    )
    await session.flush()
    return {"id": str(receipt.id), "journalized_at": receipt.journalized_at.isoformat()}


@router.patch("/ledger/{receipt_id}")
async def edit_ledger(
    receipt_id: UUID,
    body: Journalize,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """元帳(仕分け済)の1件を修正する。仕訳日時(journalized_at)は維持する。"""
    receipt = await session.get(Receipt, receipt_id)
    if not receipt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "receipt not found")
    if receipt.journalized_at is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "not journalized yet")

    _apply_journalize_fields(receipt, body)
    # 取引先(自由入力)はマスタ完全一致のときだけ partner_id を引当(推測しない)。
    if body.partner_name is not None:
        receipt.partner_id = await journaling.partner_id_for(
            session, receipt.client_id, receipt.partner_name, receipt.t_number
        )
    # journalized_at / journal_hold は据え置き（仕訳日時を変えない）。

    # 修正内容を学習に反映（次回以降の自動仕訳の精度を上げる）。
    await journaling.learn(
        session,
        receipt,
        account_title_id=body.account_title_id,
        sub_account_id=body.sub_account_id,
        partner_id=receipt.partner_id,
    )
    await session.flush()
    return {"id": str(receipt.id), "journalized_at": receipt.journalized_at.isoformat()}


async def _set_hold(session: AsyncSession, receipt_id: UUID, hold: bool):
    receipt = await session.get(Receipt, receipt_id)
    if not receipt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "receipt not found")
    receipt.journal_hold = hold
    await session.flush()
    return {"id": str(receipt.id), "journal_hold": hold}


@router.post("/receipts/{receipt_id}/hold")
async def hold(
    receipt_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    return await _set_hold(session, receipt_id, True)


@router.post("/receipts/{receipt_id}/unhold")
async def unhold(
    receipt_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    return await _set_hold(session, receipt_id, False)
