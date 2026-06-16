"""Receipt list / detail / edit. Rows are RLS-scoped to the principal's tenants."""

from datetime import date as _date, datetime, time, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import Principal, get_principal
from ..models import UNPARSED_VENDOR, ApprovalStatus, File, Receipt, ReceiptFile, User

router = APIRouter(prefix="/receipts", tags=["receipts"])


class ReceiptPatch(BaseModel):
    vendor: str | None = None
    date: str | None = None  # 領収書の日付(captured_at)。YYYY-MM-DD
    amount_jpy: int | None = None
    tax_mode: str | None = None
    payment_method: str | None = None
    t_number: str | None = None
    description: str | None = None  # 摘要
    account_title_id: UUID | None = None
    sub_account_id: UUID | None = None
    partner_id: UUID | None = None
    approval_status: str | None = None
    note_ids: list[str] | None = None  # 付箋: replace the attached set


# 登録者本人(RLS='own', 一般社員/利用者)が触れる「領収書の中身」。AI の読み取り間違いを
# 直すための項目で、承認(仕訳)前に限り編集できる。
_OWN_CONTENT_FIELDS = {
    "vendor", "date", "amount_jpy", "tax_mode", "payment_method", "t_number", "description",
}
# 仕訳に関わる項目は担当者(RLS='all': 管理者/経理/職員)だけが触れる。
_MANAGER_ONLY_FIELDS = {"account_title_id", "sub_account_id", "partner_id"}


def _parse_date(s: str | None) -> datetime | None:
    """YYYY-MM-DD 等を captured_at 用の datetime に。失敗時 None。"""
    if not s:
        return None
    txt = s.strip().replace("/", "-").replace(".", "-")[:10]
    try:
        return datetime.combine(_date.fromisoformat(txt), time(0, 0), tzinfo=timezone.utc)
    except ValueError:
        return None


def _serialize(r: Receipt, image_file_id=None, created_by_name=None, image_mime=None) -> dict:
    return {
        "id": str(r.id),
        "client_id": str(r.client_id),
        "source": r.source,
        "doc_type": r.doc_type,  # 'receipt' | 'card_statement'
        "match_id": str(r.match_id) if r.match_id else None,  # 突き合わせグループ
        "captured_at": r.captured_at.isoformat() if r.captured_at else None,
        "vendor": r.vendor,
        "amount_jpy": r.amount_jpy,
        "tax_mode": r.tax_mode,
        "payment_method": r.payment_method,
        "t_number": r.t_number,
        "description": r.description,
        # 請求書として認識できなかった(AI解析で店舗名も金額も取れなかった)行。受信箱で
        # 『未解析(処理待ち)』ではなく『認識できなかった』と出し分けるための印。人が
        # 店舗名を入れたら解消するよう、印があっても vendor が実値なら false。
        "parse_failed": bool((r.capture_meta or {}).get("parse_failed"))
        and (r.vendor is None or r.vendor == UNPARSED_VENDOR),
        "account_title_id": str(r.account_title_id) if r.account_title_id else None,
        "approval_status": r.approval_status,
        "journalized_at": r.journalized_at.isoformat() if r.journalized_at else None,
        "note_ids": r.note_ids or [],
        # The captured image (kind='capture'), so the UI can show/open it.
        "image_file_id": str(image_file_id) if image_file_id else None,
        "image_mime": image_mime,  # application/pdf か image/* かでアイコンを出し分け
        # 登録者名（管理者/経理/職員のみ意味を持つ。一般社員は自分のみ）。
        "created_by_name": created_by_name,
    }


async def _creator_names(session: AsyncSession, rows) -> dict:
    ids = {r.created_by for r in rows if r.created_by}
    if not ids:
        return {}
    crows = await session.execute(
        select(User.id, User.name, User.email).where(User.id.in_(ids))
    )
    return {uid: (name or email) for uid, name, email in crows.all()}


@router.get("")
async def list_receipts(
    client_id: UUID | None = None,
    q: str | None = None,
    limit: int = 100,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    # 削除(approval_status='deleted')された領収書は受信箱に出さない(消えたように見せる)。
    stmt = (
        select(Receipt)
        .where(Receipt.approval_status != ApprovalStatus.deleted.value)
        .order_by(Receipt.created_at.desc())
        .limit(min(limit, 500))
    )
    if client_id:
        stmt = stmt.where(Receipt.client_id == client_id)
    if q:
        stmt = stmt.where(text("search_text ILIKE :q")).params(q=f"%{q}%")
    rows = list(await session.scalars(stmt))
    # Map each receipt to its captured image file (if any) in one query.
    img_map: dict = {}
    if rows:
        rf = await session.execute(
            select(ReceiptFile.receipt_id, ReceiptFile.file_id, File.mime)
            .join(File, File.id == ReceiptFile.file_id)
            .where(
                ReceiptFile.receipt_id.in_([r.id for r in rows]),
                ReceiptFile.kind == "capture",
            )
        )
        for rid, fid, mime in rf.all():
            img_map.setdefault(rid, (fid, mime))
        creators = await _creator_names(session, rows)
    else:
        creators = {}
    out = []
    for r in rows:
        fid, mime = img_map.get(r.id, (None, None))
        out.append(_serialize(r, fid, creators.get(r.created_by), mime))
    return out


@router.get("/{receipt_id}")
async def get_receipt(
    receipt_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    r = await session.get(Receipt, receipt_id)
    if not r:
        return {"error": "not found"}
    img_row = (
        await session.execute(
            select(ReceiptFile.file_id, File.mime)
            .join(File, File.id == ReceiptFile.file_id)
            .where(ReceiptFile.receipt_id == r.id, ReceiptFile.kind == "capture")
        )
    ).first()
    fid, mime = (img_row[0], img_row[1]) if img_row else (None, None)
    creators = await _creator_names(session, [r])
    return _serialize(r, fid, creators.get(r.created_by), mime)


@router.get("/{receipt_id}/email")
async def receipt_email(
    receipt_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """メール取込の領収書について、件名/差出人/本文を返す(「メール本文を印刷したような
    画面」表示用)。RLS によりアクセス不可なら404。"""
    r = await session.get(Receipt, receipt_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "receipt not found")
    m = r.capture_meta or {}
    return {
        "subject": m.get("gmail_subject"),
        "from_addr": m.get("gmail_from"),
        "account": m.get("gmail_account"),
        "date": m.get("gmail_date"),
        "html": m.get("gmail_body_html"),
        "text": m.get("gmail_body_text"),
    }


@router.patch("/{receipt_id}")
async def patch_receipt(
    receipt_id: UUID,
    body: ReceiptPatch,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    r = await session.get(Receipt, receipt_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "receipt not found")
    data = body.model_dump(exclude_unset=True)

    # 権限レベルを RLS ヘルパで判定: 'all'=担当者(管理者/経理/職員) / 'own'=登録者本人。
    # RLS でそもそも見えない行は session.get が None を返すので、ここに来る時点で
    # 「触れてよい行」だけ。'own' のときに何を許すかをアプリ側でさらに絞る。
    access = await session.scalar(
        text("SELECT app_client_access(:c)"), {"c": str(r.client_id)}
    )
    if access != "all":
        # 登録者本人: AI の読み取り内容を「承認(仕訳)前の自分の領収書」に限り修正できる。
        # 科目・取引先(仕訳項目)は不可。承認状態は自分の取り消し(deleted)のみ許可し、
        # 否認/間違い等の承認操作はできない。
        if _MANAGER_ONLY_FIELDS & data.keys():
            raise HTTPException(status.HTTP_403_FORBIDDEN, "科目・取引先は担当者のみ編集できます")
        if "approval_status" in data and data["approval_status"] != ApprovalStatus.deleted.value:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "承認状態は変更できません")
        # 中身の修正・取り消しは「未仕分(pending) かつ 未確定」のときだけ。確定後はロック。
        if (_OWN_CONTENT_FIELDS | {"approval_status"}) & data.keys():
            if r.journalized_at is not None or r.approval_status != ApprovalStatus.pending.value:
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN, "確定済み/処理済みのため編集できません"
                )

    # 日付(captured_at)は別名・要パース。空/不正は据え置き(誤って日付を消さない)。
    if "date" in data:
        parsed = _parse_date(data.pop("date"))
        if parsed is not None:
            r.captured_at = parsed
    for field, value in data.items():
        setattr(r, field, value)
    await session.flush()
    # 一覧/詳細と同じ形(画像・登録者名込み)で返す。フロントが行をそのまま差し替えても
    # 画像リンク等が欠けないようにする。
    img_row = (
        await session.execute(
            select(ReceiptFile.file_id, File.mime)
            .join(File, File.id == ReceiptFile.file_id)
            .where(ReceiptFile.receipt_id == r.id, ReceiptFile.kind == "capture")
        )
    ).first()
    fid, mime = (img_row[0], img_row[1]) if img_row else (None, None)
    creators = await _creator_names(session, [r])
    return _serialize(r, fid, creators.get(r.created_by), mime)


@router.delete("/{receipt_id}")
async def delete_receipt(
    receipt_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """Delete an un-approved (not yet journalized) receipt. RLS scopes which
    receipts the caller can touch — own for 一般社員, all for 管理者/経理/職員."""
    r = await session.get(Receipt, receipt_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "receipt not found")
    if r.journalized_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "確定済みの領収書は削除できません")
    await session.delete(r)
    return {"ok": True}
