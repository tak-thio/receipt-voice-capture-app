"""Receipt list / detail / edit. Rows are RLS-scoped to the principal's tenants."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import Principal, get_principal
from ..models import File, Receipt, ReceiptFile, User

router = APIRouter(prefix="/receipts", tags=["receipts"])


class ReceiptPatch(BaseModel):
    vendor: str | None = None
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


def _serialize(r: Receipt, image_file_id=None, created_by_name=None, image_mime=None) -> dict:
    return {
        "id": str(r.id),
        "client_id": str(r.client_id),
        "source": r.source,
        "captured_at": r.captured_at.isoformat() if r.captured_at else None,
        "vendor": r.vendor,
        "amount_jpy": r.amount_jpy,
        "tax_mode": r.tax_mode,
        "payment_method": r.payment_method,
        "t_number": r.t_number,
        "description": r.description,
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
    stmt = select(Receipt).order_by(Receipt.created_at.desc()).limit(min(limit, 500))
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
        return {"error": "not found"}
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(r, field, value)
    await session.flush()
    return _serialize(r)


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
