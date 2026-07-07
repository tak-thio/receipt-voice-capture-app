"""Receipt list / detail / edit. Rows are RLS-scoped to the principal's tenants."""

from datetime import date as _date, datetime, time, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, nullslast, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import audit, dedup
from ..db import get_session
from ..deps import Principal, get_principal
from ..models import UNPARSED_VENDOR, ApprovalStatus, AuditLog, File, Receipt, ReceiptFile, User

router = APIRouter(prefix="/receipts", tags=["receipts"])


class ReceiptPatch(BaseModel):
    vendor: str | None = None
    date: str | None = None  # 領収書の日付(captured_at)。YYYY-MM-DD
    amount_jpy: int | None = None
    tax_mode: str | None = None
    payment_method: str | None = None
    t_number: str | None = None
    description: str | None = None  # 摘要
    memo: str | None = None  # 自由メモ(都度編集)
    account_title_id: UUID | None = None
    sub_account_id: UUID | None = None
    partner_id: UUID | None = None
    approval_status: str | None = None
    note_ids: list[str] | None = None  # 付箋: replace the attached set


class MergeBody(BaseModel):
    primary_id: UUID       # 合成の基準(金額・T番号などを優先。既定=金額最大の「鏡」)
    merge_ids: list[UUID]  # 一緒に束ねる領収書(明細など)。基準+これらから統合伝票を作る


class UnmergeBody(BaseModel):
    voucher_id: UUID       # ばらす統合伝票。束ねた元(merged_into=これ)を復元し、統合伝票は削除


# 登録者本人(RLS='own', 一般社員/利用者)が触れる「領収書の中身」。AI の読み取り間違いを
# 直すための項目で、承認(仕訳)前に限り編集できる。
_OWN_CONTENT_FIELDS = {
    "vendor", "date", "amount_jpy", "tax_mode", "payment_method", "t_number", "description", "memo",
}
# 仕訳に関わる項目は担当者(RLS='all': 管理者/経理/職員)だけが触れる。
_MANAGER_ONLY_FIELDS = {"account_title_id", "sub_account_id", "partner_id"}
# 重複(突き合わせ)判定に効く項目。これらが編集されたら recompute_dedup を呼ぶ。
_DEDUP_FIELDS = {"vendor", "date", "amount_jpy", "approval_status"}


def _parse_date(s: str | None) -> datetime | None:
    """YYYY-MM-DD 等を captured_at 用の datetime に。失敗時 None。"""
    if not s:
        return None
    txt = s.strip().replace("/", "-").replace(".", "-")[:10]
    try:
        return datetime.combine(_date.fromisoformat(txt), time(0, 0), tzinfo=timezone.utc)
    except ValueError:
        return None


def _serialize(r: Receipt, images=None, created_by_name=None) -> dict:
    imgs = images or []  # [(file_id, mime), ...] capture画像。複数=マージ(明細+鏡)で1支払いに束ねたもの。
    return {
        "id": str(r.id),
        "client_id": str(r.client_id),
        "source": r.source,
        "lane": r.lane,  # 'company' | 'expense'
        "doc_type": r.doc_type,  # 'receipt' | 'card_statement'
        "match_id": str(r.match_id) if r.match_id else None,  # 突き合わせグループ
        "captured_at": r.captured_at.isoformat() if r.captured_at else None,
        "vendor": r.vendor,
        "amount_jpy": r.amount_jpy,
        "tax_mode": r.tax_mode,
        "payment_method": r.payment_method,
        "t_number": r.t_number,
        "description": r.description,
        "memo": r.memo,  # 自由メモ(ファイル名/ページ/音声を初期値、以後編集可)
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
        # 先頭を代表画像として image_file_id/image_mime に(既存フロント互換)。images に全画像。
        "image_file_id": str(imgs[0][0]) if imgs else None,
        "image_mime": imgs[0][1] if imgs else None,  # application/pdf か image/* かでアイコンを出し分け
        "images": [{"file_id": str(fid), "mime": mime} for fid, mime in imgs],
        # PDFの何ページ目由来か(プレビューを ?page=N で出すため)。画像/単票は null。
        "page": (r.capture_meta or {}).get("page"),
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


async def _capture_images(session: AsyncSession, receipt_id) -> list:
    """capture 画像を [(file_id, mime), ...] で返す。統合伝票なら束ねた元(merged_into=self)の画像も含む。"""
    parent = func.coalesce(Receipt.merged_into, Receipt.id)
    rows = await session.execute(
        select(ReceiptFile.file_id, File.mime)
        .join(Receipt, Receipt.id == ReceiptFile.receipt_id)
        .join(File, File.id == ReceiptFile.file_id)
        .where(parent == receipt_id, ReceiptFile.kind == "capture")
        .order_by(ReceiptFile.id)
    )
    return [(fid, mime) for fid, mime in rows.all()]


@router.get("")
async def list_receipts(
    client_id: UUID | None = None,
    q: str | None = None,
    lane: str = "company",  # company=会社経費(受信箱) / expense=立替経費(未申請トレイ)
    date_from: str | None = None,  # 取引年月日(範囲・開始) YYYY-MM-DD
    date_to: str | None = None,  # 取引年月日(範囲・終了) YYYY-MM-DD
    amount_min: int | None = None,  # 取引金額(範囲・下限)
    amount_max: int | None = None,  # 取引金額(範囲・上限)
    limit: int = 100,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    # 削除(approval_status='deleted')された領収書は受信箱に出さない(消えたように見せる)。
    stmt = (
        select(Receipt)
        .where(Receipt.approval_status != ApprovalStatus.deleted.value)
        # マージで束ねた「元」(merged_into 非NULL)は受信箱に出さない(統合伝票だけ表示)。
        .where(Receipt.merged_into.is_(None))
        # 領収書の日付(captured_at)の新しい順。日付なし(未読取等)は末尾、同日は取込順(created_at)。
        .order_by(nullslast(Receipt.captured_at.desc()), Receipt.created_at.desc())
        .limit(min(limit, 500))
    )
    if client_id:
        stmt = stmt.where(Receipt.client_id == client_id)
    # レーンで絞り込み(既定=会社経費)。lane='all' は両モード(モバイルの本人受信箱用)。
    # クレジット明細は専用画面で扱うので受信箱には出さない。
    if lane != "all":
        stmt = stmt.where(Receipt.lane == lane)
    stmt = stmt.where(Receipt.doc_type != "card_statement")
    if q:
        stmt = stmt.where(text("search_text ILIKE :q")).params(q=f"%{q}%")
    # 電子帳簿保存法の検索要件: 取引年月日(範囲)・取引金額(範囲)。取引先は q(search_text)で対応。
    if date_from:
        try:
            stmt = stmt.where(func.date(Receipt.captured_at) >= _date.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            stmt = stmt.where(func.date(Receipt.captured_at) <= _date.fromisoformat(date_to))
        except ValueError:
            pass
    if amount_min is not None:
        stmt = stmt.where(Receipt.amount_jpy >= amount_min)
    if amount_max is not None:
        stmt = stmt.where(Receipt.amount_jpy <= amount_max)
    rows = list(await session.scalars(stmt))
    # Map each receipt to its captured image file (if any) in one query.
    img_map: dict = {}
    if rows:
        # 画像はその「実効親」= COALESCE(merged_into, id) に集約(統合伝票は束ねた元の画像を持つ)。
        parent = func.coalesce(Receipt.merged_into, Receipt.id)
        rf = await session.execute(
            select(parent, ReceiptFile.file_id, File.mime)
            .join(Receipt, Receipt.id == ReceiptFile.receipt_id)
            .join(File, File.id == ReceiptFile.file_id)
            .where(parent.in_([r.id for r in rows]), ReceiptFile.kind == "capture")
            .order_by(ReceiptFile.id)
        )
        for pid, fid, mime in rf.all():
            img_map.setdefault(pid, []).append((fid, mime))
        creators = await _creator_names(session, rows)
    else:
        creators = {}
    out = []
    for r in rows:
        out.append(_serialize(r, img_map.get(r.id, []), creators.get(r.created_by)))
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
    imgs = await _capture_images(session, r.id)
    creators = await _creator_names(session, [r])
    return _serialize(r, imgs, creators.get(r.created_by))


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
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    r = await session.get(Receipt, receipt_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "receipt not found")
    data = body.model_dump(exclude_unset=True)
    _touched = set(data)
    # 監査ログ用に変更前の値を控える(date は captured_at にマップ)。
    _before = {
        k: audit.jsonable(r.captured_at if k == "date" else getattr(r, k, None)) for k in _touched
    }

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
    # 編集で重複キー(店舗名/日付/金額/承認状態)が変わると突き合わせ結果も変わるため再計算する。
    # これが無いと、AIが誤読した日付を直しても重複として検知されない。
    if _DEDUP_FIELDS & _touched:
        await dedup.recompute_dedup(session, r.client_id)
    # 監査ログ(電帳法の訂正削除履歴): 変わったフィールドだけ before→after を記録。
    _changes = {
        k: {
            "before": _before[k],
            "after": audit.jsonable(r.captured_at if k == "date" else getattr(r, k, None)),
        }
        for k in _touched
    }
    _changes = {k: v for k, v in _changes.items() if v["before"] != v["after"]}
    if _changes:
        _act = "deleted" if data.get("approval_status") == ApprovalStatus.deleted.value else "updated"
        await audit.log_audit(
            session, firm_id=r.firm_id, client_id=r.client_id, actor_user_id=principal.user.id,
            action=_act, target_type="receipt", target_id=r.id, changes=_changes,
        )
    # 一覧/詳細と同じ形(画像・登録者名込み)で返す。フロントが行をそのまま差し替えても
    # 画像リンク等が欠けないようにする。
    imgs = await _capture_images(session, r.id)
    creators = await _creator_names(session, [r])
    return _serialize(r, imgs, creators.get(r.created_by))


@router.post("/merge")
async def merge_receipts(
    body: MergeBody,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """明細+鏡など「1つの支払いに画像が複数」を1件の統合伝票にまとめる。
    元(sources)は変更せず merged_into で統合伝票に紐付けて隠す(全集計の対象外)。統合伝票のデータは
    基準(primary)を優先し空欄を他から補完、金額は合算しない(同一支払い)。未仕訳のみ。ばらすで復元可。"""
    base = await session.get(Receipt, body.primary_id)
    if base is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "基準の領収書が見つかりません")
    sources = [base]
    seen = {base.id}
    for mid in body.merge_ids:
        if mid in seen:
            continue
        seen.add(mid)
        r = await session.get(Receipt, mid)
        if r is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "マージ対象が見つかりません")
        sources.append(r)
    for s in sources:
        if s.client_id != base.client_id or s.lane != base.lane:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "顧問先/レーンが異なる領収書はマージできません")
        # 未仕訳(pending)に加え、重複候補(duplicate=dedupが自動で付ける)もマージ対象にする。
        if (s.journalized_at is not None
                or s.approval_status not in (ApprovalStatus.pending.value, "duplicate")
                or s.merged_into is not None):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "確定済み/処理済み/マージ済みはマージできません")
    if len(sources) < 2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "マージには2件以上必要です")
    # 合成: 基準を優先し、空欄は他ソース(金額の大きい順)から補完。金額は基準優先=合算しない。
    others = sorted((s for s in sources if s.id != base.id), key=lambda s: -(s.amount_jpy or 0))
    ordered = [base, *others]

    def pick(field):
        for s in ordered:
            v = getattr(s, field)
            if v is not None and v != "":
                return v
        return None

    voucher = Receipt(
        firm_id=base.firm_id, client_id=base.client_id, lane=base.lane,
        source=base.source, doc_type="receipt", created_by=principal.user.id,
        approval_status=ApprovalStatus.pending.value,
        captured_at=pick("captured_at"), vendor=pick("vendor"), partner_name=pick("partner_name"),
        amount_jpy=pick("amount_jpy"), subtotal_jpy=pick("subtotal_jpy"), tax_jpy=pick("tax_jpy"),
        tax_10_jpy=pick("tax_10_jpy"), tax_8_jpy=pick("tax_8_jpy"), tax_mode=pick("tax_mode"),
        payment_method=pick("payment_method"), t_number=pick("t_number"),
        description=pick("description"), memo=pick("memo"),
        capture_meta={"merged_from": [str(s.id) for s in sources]},
    )
    session.add(voucher)
    await session.flush()  # voucher.id を確定
    for s in sources:
        s.merged_into = voucher.id  # 元を統合伝票に紐付け(隠す・集計対象外)。画像はそのまま元に残る。
    await audit.log_audit(
        session, firm_id=base.firm_id, client_id=base.client_id, actor_user_id=principal.user.id,
        action="merged", target_type="receipt", target_id=voucher.id,
        summary=f"{len(sources)}件を統合伝票にまとめた(明細+鏡)",
    )
    await session.flush()
    await dedup.recompute_dedup(session, base.client_id)
    imgs = await _capture_images(session, voucher.id)
    creators = await _creator_names(session, [voucher])
    return {**_serialize(voucher, imgs, creators.get(voucher.created_by)), "merged": len(sources)}


@router.post("/unmerge")
async def unmerge_receipts(
    body: UnmergeBody,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """統合伝票を「ばらす」: 束ねた元(merged_into=voucher)を復元して受信箱に戻し、統合伝票は削除。
    元は一切変更していないので確実に元通り。未仕訳(統合伝票が未確定)のときだけ。"""
    voucher = await session.get(Receipt, body.voucher_id)
    if voucher is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "統合伝票が見つかりません")
    if voucher.journalized_at is not None or voucher.approval_status != ApprovalStatus.pending.value:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "確定済み/処理済みの統合伝票はばらせません")
    children = list(await session.scalars(select(Receipt).where(Receipt.merged_into == voucher.id)))
    if not children:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "この領収書はマージされていません")
    for c in children:
        c.merged_into = None  # 元を復元(受信箱に戻る)
    voucher.approval_status = ApprovalStatus.deleted.value  # 統合伝票は削除(消えたように)
    await audit.log_audit(
        session, firm_id=voucher.firm_id, client_id=voucher.client_id, actor_user_id=principal.user.id,
        action="unmerged", target_type="receipt", target_id=voucher.id,
        summary=f"統合伝票をばらして{len(children)}件を復元",
    )
    await session.flush()
    await dedup.recompute_dedup(session, voucher.client_id)
    return {"unmerged": len(children)}


@router.delete("/{receipt_id}")
async def delete_receipt(
    receipt_id: UUID,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """Delete an un-approved (not yet journalized) receipt. RLS scopes which
    receipts the caller can touch — own for 一般社員, all for 管理者/経理/職員."""
    r = await session.get(Receipt, receipt_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "receipt not found")
    if r.journalized_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "確定済みの領収書は削除できません")
    # 監査ログ(電帳法の削除履歴): 行が消える前に記録(対象の概要も残す)。
    await audit.log_audit(
        session, firm_id=r.firm_id, client_id=r.client_id, actor_user_id=principal.user.id,
        action="deleted", target_type="receipt", target_id=r.id,
        summary=f"{r.vendor or ''} {r.amount_jpy or ''} {r.captured_at.date().isoformat() if r.captured_at else ''}".strip(),
    )
    await session.delete(r)
    return {"ok": True}


@router.get("/{receipt_id}/history")
async def receipt_history(
    receipt_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """この領収書の監査ログ(訂正削除・承認・仕訳の履歴)。RLSで自テナント分のみ。"""
    items = list(
        await session.scalars(
            select(AuditLog)
            .where(AuditLog.target_type == "receipt", AuditLog.target_id == receipt_id)
            .order_by(AuditLog.created_at.desc())
        )
    )
    uids = {a.actor_user_id for a in items if a.actor_user_id}
    names: dict = {}
    if uids:
        rows = await session.execute(select(User.id, User.name).where(User.id.in_(uids)))
        names = {uid: nm for uid, nm in rows.all()}
    return [
        {
            "id": str(a.id),
            "action": a.action,
            "actor": names.get(a.actor_user_id),
            "summary": a.summary,
            "changes": a.changes,
            "at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in items
    ]
