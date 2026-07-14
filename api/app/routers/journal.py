"""仕分け (journaling) queue, suggestion, and confirm/learn.

Engine lives in app/journaling.py. The queue returns rich items (with image and
a per-item suggestion) so the web app can render receipt-app's single-item
"拡大表示" journaling UX. Rows are RLS-isolated to the principal's tenants.
"""

from datetime import date, datetime, time, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import audit, journaling
from ..db import get_session
from ..deps import Principal, get_principal
from ..models import UNPARSED_VENDOR, AccountTitle, File, Partner, Receipt, ReceiptFile, ReceiptLane, User

router = APIRouter(prefix="/journal", tags=["journal"])

# 仕訳の元になれる行:
# - 通常の領収書(card_statement 以外)
# - クレジット明細行のうち「領収書なし(確定)」(link_manual=true かつ 紐付け先なし)のもの。
#   支払いは事実で、領収書が無い場合は明細が唯一の証憑になるため明細行から起票する。
#   領収書あり(自動/手動)の行は領収書側を仕訳するのでキューに出さない(二重計上防止)。
#   税内訳は明細に無いので空のまま(記帳時に必要なら手入力)。
_JOURNAL_SOURCE = or_(
    Receipt.doc_type != "card_statement",
    and_(
        Receipt.capture_meta["link_manual"].astext == "true",
        Receipt.capture_meta["linked_receipt_id"].astext.is_(None),
    ),
)


class TaxLine(BaseModel):
    """消費税内訳の1行。請求書に印字された値をそのまま保存(計算しない)。
    label=書面の表記そのまま("10%"/"8%"/"その他"/"非課税"/"対象外"/将来の新税率)。"""
    label: str | None = None
    tax_jpy: int | None = None
    base_jpy: int | None = None


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
    tax_lines: list[TaxLine] | None = None  # 消費税内訳(行リスト・請求書通り)
    tax_mode: str | None = None  # inclusive / exclusive / unknown
    currency: str | None = None  # 外貨コード("USD"等)。円建ては null
    foreign_amount: float | None = None  # 現地(外貨)支払総額
    payment_method: str | None = None
    t_number: str | None = None  # インボイス番号
    description: str | None = None  # 摘要
    memo: str | None = None  # 自由メモ(都度編集)


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
    if body.tax_lines is not None:
        receipt.tax_lines = [line.model_dump() for line in body.tax_lines]
    if body.currency is not None:
        receipt.currency = body.currency.strip().upper() or None
    if body.foreign_amount is not None:
        receipt.foreign_amount = body.foreign_amount
    if body.t_number is not None:
        receipt.t_number = body.t_number or None
    if body.description is not None:
        receipt.description = body.description or None
    if body.memo is not None:
        receipt.memo = body.memo or None


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


async def _capture_images_map(session: AsyncSession, receipt_ids) -> dict:
    """receipt_id -> [(file_id, mime), ...] を1クエリで。統合伝票は束ねた元(merged_into=self)の
    capture画像もこの親IDに集約して返す(仕訳/元帳で明細+鏡の全画像を出すため)。"""
    ids = [rid for rid in receipt_ids]
    if not ids:
        return {}
    parent = func.coalesce(Receipt.merged_into, Receipt.id)
    rows = await session.execute(
        select(parent.label("pid"), ReceiptFile.file_id, File.mime)
        .join(Receipt, Receipt.id == ReceiptFile.receipt_id)
        .join(File, File.id == ReceiptFile.file_id)
        .where(parent.in_(ids), ReceiptFile.kind == "capture")
        .order_by(ReceiptFile.id)
    )
    out: dict = {}
    for pid, fid, mime in rows.all():
        out.setdefault(pid, []).append((fid, mime))
    return out


@router.get("/queue")
async def queue(
    client_id: UUID | None = None,
    view: str = "queue",  # "queue" (un-held) | "held"
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    held = view == "held"
    # 未処理（pending）のみ。否認/間違い/削除/重複（approval_status）は除外される。
    # 自動重複(突き合わせ)で duplicate にされた行は pending ではないので自動的に外れる
    # = 二重計上しない（本体＝親レコードだけが pending として残る）。
    # 立替(expense)は経費精算の承認で仕訳。クレジット明細は原則仕訳の元にしないが、
    # 「領収書なし(確定)」の行だけは例外(_JOURNAL_SOURCE 参照)。
    conds = [
        Receipt.journalized_at.is_(None),
        Receipt.approval_status == "pending",
        Receipt.lane == ReceiptLane.company.value,
        _JOURNAL_SOURCE,
        # マージで束ねた元(統合伝票に紐付いた明細/鏡)は仕訳キューに出さない(二重仕訳防止)。
        Receipt.merged_into.is_(None),
    ]
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

    imgs_map = await _capture_images_map(session, [r.id for r in rows])
    items = []
    for r in rows:
        suggestion = await journaling.suggest(session, r)
        imgs = imgs_map.get(r.id, [])
        items.append(
            {
                "id": str(r.id),
                "doc_type": r.doc_type,  # card_statement=「領収書なし確定」の明細から起票する行
                "vendor": r.vendor,
                # 受信箱と同じく「請求書として認識できなかった」行を出し分ける印。
                "parse_failed": bool((r.capture_meta or {}).get("parse_failed"))
                and (r.vendor is None or r.vendor == UNPARSED_VENDOR),
                "created_by_name": creators.get(r.created_by),
                "amount_jpy": r.amount_jpy,
                "subtotal_jpy": r.subtotal_jpy,
                "tax_jpy": r.tax_jpy,
                "tax_lines": r.tax_lines or [],
                "currency": r.currency,
                "foreign_amount": float(r.foreign_amount) if r.foreign_amount is not None else None,
                "date": r.captured_at.date().isoformat() if r.captured_at else None,
                "source": r.source,
                "t_number": r.t_number,
                "description": r.description,
                "memo": r.memo,
                "image_file_id": str(imgs[0][0]) if imgs else None,
                "image_mime": imgs[0][1] if imgs else None,
                # マージ済み(統合伝票)は束ねた元の明細+鏡を全部返す。仕訳画面で切替表示する。
                "images": [{"file_id": str(fid), "mime": mime} for fid, mime in imgs],
                "page": (r.capture_meta or {}).get("page"),  # PDFの何ページ目由来か
                "tax_mode": r.tax_mode,
                "payment_method": r.payment_method,
                "account_title_id": str(r.account_title_id) if r.account_title_id else None,
                "credit_account_title_id": str(r.credit_account_title_id) if r.credit_account_title_id else None,
                "sub_account_id": str(r.sub_account_id) if r.sub_account_id else None,
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
    # 自動重複でまとめられた重複行は二重計上防止のため元帳から除外(本体＝親だけ残す)。
    stmt = stmt.where(Receipt.approval_status != "duplicate")
    # クレジット明細は原則出さないが、「領収書なし(確定)」で明細から起票した行は元帳に出す。
    stmt = stmt.where(_JOURNAL_SOURCE)
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
    imgs_map = await _capture_images_map(session, [r.id for r in rows])

    result = []
    for r in rows:
        imgs = imgs_map.get(r.id, [])
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
                "memo": r.memo,
                # 直接編集（仕分けと同じ画面）用の生の値。
                "account_title_id": str(r.account_title_id) if r.account_title_id else None,
                "credit_account_title_id": str(r.credit_account_title_id) if r.credit_account_title_id else None,
                "sub_account_id": str(r.sub_account_id) if r.sub_account_id else None,
                "partner_id": str(r.partner_id) if r.partner_id else None,
                "subtotal_jpy": r.subtotal_jpy,
                "tax_lines": r.tax_lines or [],
                "currency": r.currency,
                "foreign_amount": float(r.foreign_amount) if r.foreign_amount is not None else None,
                "tax_mode": r.tax_mode,
                "payment_method": r.payment_method,
                "source": r.source,
                "image_file_id": str(imgs[0][0]) if imgs else None,
                "image_mime": imgs[0][1] if imgs else None,
                "images": [{"file_id": str(fid), "mime": mime} for fid, mime in imgs],
                "page": (r.capture_meta or {}).get("page"),  # PDFの何ページ目由来か
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
    principal: Principal = Depends(get_principal),
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
    await audit.log_audit(
        session, firm_id=receipt.firm_id, client_id=receipt.client_id, actor_user_id=principal.user.id,
        action="journalized", target_type="receipt", target_id=receipt.id, summary="仕訳確定",
    )

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
    principal: Principal = Depends(get_principal),
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
    await audit.log_audit(
        session, firm_id=receipt.firm_id, client_id=receipt.client_id, actor_user_id=principal.user.id,
        action="updated", target_type="receipt", target_id=receipt.id, summary="元帳修正(仕訳済の訂正)",
    )

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
