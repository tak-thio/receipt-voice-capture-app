"""Receipt list / detail / edit. Rows are RLS-scoped to the principal's tenants."""

from datetime import date as _date, datetime, time, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, nullslast, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import audit, dedup
from .card_statements import _MATCH_DAYS  # 照合の日付許容幅(自動照合と同じ規則を使う)
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
    source_ids: list[UUID]           # 束ねる領収書(2件以上)。これらから統合伝票を作る
    values: dict[str, object] = {}   # 統合伝票に採用する各項目の値(フロントの選択/編集結果)


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
        "tax_lines": r.tax_lines or [],  # 消費税内訳 [{label, tax_jpy, base_jpy}](書面の表記そのまま)
        # 外貨取引(書面の印字値そのまま)。円建ては全て null。照合キー=(currency, foreign_amount)。
        "currency": r.currency,
        "foreign_amount": float(r.foreign_amount) if r.foreign_amount is not None else None,
        "exchange_rate": float(r.exchange_rate) if r.exchange_rate is not None else None,
        "payment_method": r.payment_method,
        "t_number": r.t_number,
        "description": r.description,
        "memo": r.memo,  # 自由メモ(ファイル名/ページ/音声を初期値、以後編集可)
        # 請求書として認識できなかった(AI解析で店舗名も金額も取れなかった)行。受信箱で
        # 『未解析(処理待ち)』ではなく『認識できなかった』と出し分けるための印。人が
        # 店舗名を入れたら解消するよう、印があっても vendor が実値なら false。
        "parse_failed": bool((r.capture_meta or {}).get("parse_failed"))
        and (r.vendor is None or r.vendor == UNPARSED_VENDOR),
        # AI解析がまだ完了していない(未解析=vendorがplaceholderのまま かつ 解析失敗印なし)。
        # 受信箱で「解析中…」表示＋自動ポーリングに使う。
        "processing": (r.vendor is None or r.vendor == UNPARSED_VENDOR)
        and not bool((r.capture_meta or {}).get("parse_failed")),
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


_JST = timezone(timedelta(hours=9))


def _default_batch_label(imported_at) -> str:
    """受信箱に出すクレジット明細バッチの既定ラベル: 「YYYY年MM月DD日アップロード」(JST)。"""
    if not imported_at:
        return "クレジット明細"
    d = imported_at.astimezone(_JST)
    return f"{d.year}年{d.month:02d}月{d.day:02d}日アップロード"


async def _card_batch_rows(session: AsyncSession, client_id) -> list:
    """クレジット明細の取込バッチ(card_batch_id 単位)を受信箱の「塊」1行に要約して返す。
    明細の各行は展開しない。仕訳・金額集計には入れない(表示のみ)。ラベルは既定=取込日、変更可。"""
    bstmt = (
        select(
            Receipt.card_batch_id,
            func.count(Receipt.id).label("cnt"),
            func.min(Receipt.created_at).label("imported_at"),
            func.max(Receipt.capture_meta["card_batch_label"].astext).label("label"),
        )
        .where(
            Receipt.doc_type == "card_statement",
            Receipt.card_batch_id.isnot(None),
            Receipt.approval_status != ApprovalStatus.deleted.value,
            Receipt.merged_into.is_(None),
        )
        .group_by(Receipt.card_batch_id)
        .order_by(func.min(Receipt.created_at).desc())
        .limit(200)
    )
    if client_id:
        bstmt = bstmt.where(Receipt.client_id == client_id)
    batches = (await session.execute(bstmt)).all()
    if not batches:
        return []
    bids = [b.card_batch_id for b in batches]
    # 各バッチの明細ファイル(全行が共有)を1つ取得(受信箱で画像を出す)。
    bf = await session.execute(
        select(Receipt.card_batch_id, ReceiptFile.file_id, File.mime)
        .join(ReceiptFile, ReceiptFile.receipt_id == Receipt.id)
        .join(File, File.id == ReceiptFile.file_id)
        .where(Receipt.card_batch_id.in_(bids), ReceiptFile.kind == "capture")
        .order_by(ReceiptFile.id)
    )
    file_of: dict = {}
    for bid, fid, mime in bf.all():
        file_of.setdefault(bid, (fid, mime))
    out = []
    for b in batches:
        fid, mime = file_of.get(b.card_batch_id, (None, None))
        label = b.label or _default_batch_label(b.imported_at)
        out.append({
            "id": str(b.card_batch_id),
            "client_id": str(client_id) if client_id else None,
            "source": "card", "lane": "company", "doc_type": "card_statement",
            "card_batch": {"count": b.cnt, "short_id": str(b.card_batch_id)[:6], "label": label},
            "captured_at": b.imported_at.isoformat() if b.imported_at else None,
            # vendor にも表示名を入れる: card_batch を知らないクライアント(モバイル)が
            # 「未解析」(vendor空のfallback)と誤表示しないため。web は card_batch で描画し vendor 不使用。
            "vendor": f"クレジット明細 {b.cnt}件（{label}）", "partner_name": None, "amount_jpy": None,
            "tax_mode": None, "tax_lines": [], "currency": None,
            "foreign_amount": None, "exchange_rate": None,
            "payment_method": None, "t_number": None,
            "description": None, "memo": None, "account_title_id": None,
            "approval_status": "pending", "journalized_at": None, "note_ids": [],
            "image_file_id": str(fid) if fid else None, "image_mime": mime,
            "images": [{"file_id": str(fid), "mime": mime}] if fid else [],
            "page": None, "match_id": None, "merged_into": None,
            "created_by_name": None, "parse_failed": False,
        })
    return out


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
    # 「仕訳済み × 領収書なし(確定)」の明細行(=明細から起票済み)に一致しうる領収書へ印を付ける。
    # 後から領収書が出てきたケースで、領収書側も仕訳してしまう二重計上を受信箱の時点で防ぐ。
    # 照合キーは自動照合と同じ: 同額(外貨は通貨+現地額) ＋ 日付±_MATCH_DAYS。
    orphan_by_amount: dict = {}
    orphan_by_fx: dict = {}
    if client_id and rows:
        orphans = list(await session.scalars(
            select(Receipt).where(
                Receipt.client_id == client_id,
                Receipt.doc_type == "card_statement",
                Receipt.journalized_at.is_not(None),
                Receipt.approval_status != ApprovalStatus.deleted.value,
                Receipt.capture_meta["link_manual"].astext == "true",
                Receipt.capture_meta["linked_receipt_id"].astext.is_(None),
            )
        ))
        for line in orphans:
            if line.amount_jpy is not None:
                orphan_by_amount.setdefault(line.amount_jpy, []).append(line)
            if line.currency and line.currency != "JPY" and line.foreign_amount is not None:
                orphan_by_fx.setdefault((line.currency, str(line.foreign_amount)), []).append(line)

    def _orphan_match(r: Receipt) -> dict | None:
        """r(未仕訳の領収書)に一致する「明細から仕訳済み」の行(±日数最近接)を返す。"""
        if r.doc_type != "receipt" or r.journalized_at is not None or r.captured_at is None:
            return None
        cands = []
        if r.currency and r.currency != "JPY" and r.foreign_amount is not None:
            cands = orphan_by_fx.get((r.currency, str(r.foreign_amount)), [])
        if not cands and r.amount_jpy is not None:
            cands = orphan_by_amount.get(r.amount_jpy, [])
        rd = r.captured_at.date()
        best = None
        for line in cands:
            if line.captured_at is None:
                continue
            dd = abs((line.captured_at.date() - rd).days)
            if dd <= _MATCH_DAYS and (best is None or dd < best[0]):
                best = (dd, line)
        if best is None:
            return None
        line = best[1]
        return {
            "line_id": str(line.id),
            "date": line.captured_at.date().isoformat() if line.captured_at else None,
            "vendor": line.vendor,
            "amount_jpy": line.amount_jpy,
        }
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
        item = _serialize(r, img_map.get(r.id, []), creators.get(r.created_by))
        m = _orphan_match(r)
        if m:
            item["journalized_line_match"] = m  # 仕訳済み明細に紐づく領収書の可能性(受信箱で警告)
        out.append(item)
    # クレジット明細の取込バッチ(塊)を受信箱に1行で追加(会社経費の受信箱のみ)。取込日時の新しい順に並べ直す。
    if lane in ("company", "all"):
        out.extend(await _card_batch_rows(session, client_id))
        out.sort(key=lambda x: (x.get("captured_at") or ""), reverse=True)
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


# 統合伝票にまとめる項目(選択/編集の対象)。values無指定はソースから補完(partner_name/税内訳など)。
_MERGE_FIELDS = [
    "captured_at", "vendor", "partner_name", "amount_jpy", "subtotal_jpy",
    "tax_jpy", "tax_lines", "tax_mode", "payment_method",
    "t_number", "description", "memo", "currency", "foreign_amount",
]
_MERGE_INT_FIELDS = {"amount_jpy", "subtotal_jpy", "tax_jpy"}


def _coerce_merge_value(field: str, val):
    """フロントから来た値をカラム型に合わせる(日付=datetime, 金額=int, 他=str)。空はNone。"""
    if val is None or val == "":
        return None
    if field == "tax_lines":
        return val if isinstance(val, list) else None
    if field == "foreign_amount":
        try:
            return float(val)
        except (TypeError, ValueError):
            return None
    if field == "captured_at":
        if isinstance(val, str):
            try:
                return datetime.fromisoformat(val.replace("Z", "+00:00"))
            except ValueError:
                return None
        return val
    if field in _MERGE_INT_FIELDS:
        try:
            return int(val)
        except (TypeError, ValueError):
            return None
    return str(val)


def _merge_note_ids(*lists) -> list:
    """複数の note_ids(付箋)を順序保持で和集合。まとめ=元→統合伝票, ばらす=統合伝票→元 の引き継ぎに使う。"""
    out: list = []
    for lst in lists:
        for nid in (lst or []):
            if nid not in out:
                out.append(nid)
    return out


@router.post("/merge")
async def merge_receipts(
    body: MergeBody,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """明細+鏡など「1つの支払いに画像が複数」を1件の統合伝票にまとめる。項目ごとに採用値を選択(values)、
    無指定は金額の大きい順で補完。金額は合算しない(同一支払い)。元(sources)は無変更で merged_into で
    紐付けて隠す(集計対象外)。未仕訳/重複候補のみ。既存統合伝票を含む選択はそれに追加(ネストしない)。ばらすで復元可。"""
    ids: list[UUID] = []
    for sid in body.source_ids:  # 重複を除いて順序維持
        if sid not in ids:
            ids.append(sid)
    if len(ids) < 2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "マージには2件以上必要です")
    sources: list[Receipt] = []
    for sid in ids:
        r = await session.get(Receipt, sid)
        if r is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "マージ対象が見つかりません")
        sources.append(r)
    base = sources[0]
    for s in sources:
        if s.client_id != base.client_id or s.lane != base.lane:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "顧問先/レーンが異なる領収書はマージできません")
        # 未仕訳(pending)に加え、重複候補(duplicate=dedupが自動で付ける)もマージ対象にする。
        if (s.journalized_at is not None
                or s.approval_status not in (ApprovalStatus.pending.value, "duplicate")
                or s.merged_into is not None):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "確定済み/処理済み/マージ済みはマージできません")
    # 既存の統合伝票を含む場合はネストせず「その統合伝票に追加」。2件以上の統合伝票はNG。
    vouchers = [s for s in sources if (s.capture_meta or {}).get("merged_from")]
    if len(vouchers) >= 2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "統合伝票同士はまとめられません。先に『ばらす』してください")

    def coalesce(field):  # 金額の大きい順で最初の非null(=基準優先の補完)。空リスト(tax_lines)も空扱い。
        for s in sorted(sources, key=lambda x: -(x.amount_jpy or 0)):
            v = getattr(s, field)
            if v not in (None, "", []):
                return v
        return None

    def chosen(field):  # values(選択/編集)を優先、無指定はソースから補完
        if field in body.values:
            return _coerce_merge_value(field, body.values[field])
        return coalesce(field)

    if vouchers:
        # 既存の統合伝票に追加: values 指定の項目のみ更新し、残りは既存値を保持。
        voucher = vouchers[0]
        adding = [s for s in sources if s.id != voucher.id]
        for f in _MERGE_FIELDS:
            if f in body.values:
                setattr(voucher, f, _coerce_merge_value(f, body.values[f]))
        for s in adding:
            s.merged_into = voucher.id
        cm = dict(voucher.capture_meta or {})
        cm["merged_from"] = list(cm.get("merged_from") or []) + [str(s.id) for s in adding]
        voucher.capture_meta = cm
        # 追加した元の付箋も統合伝票に引き継ぐ(既存の付箋は保持)。
        voucher.note_ids = _merge_note_ids(voucher.note_ids, *[s.note_ids for s in adding])
        merged_n = len(adding)
        summary = f"統合伝票に{len(adding)}件を追加"
    else:
        voucher = Receipt(
            firm_id=base.firm_id, client_id=base.client_id, lane=base.lane,
            source=base.source, doc_type="receipt", created_by=principal.user.id,
            approval_status=ApprovalStatus.pending.value,
            **{f: chosen(f) for f in _MERGE_FIELDS},
            note_ids=_merge_note_ids(*[s.note_ids for s in sources]),  # 元の付箋を統合伝票に引き継ぐ
            capture_meta={"merged_from": [str(s.id) for s in sources]},
        )
        session.add(voucher)
        await session.flush()  # voucher.id を確定
        for s in sources:
            s.merged_into = voucher.id  # 元を統合伝票に紐付け(隠す・集計対象外)。画像はそのまま元に残る。
        merged_n = len(sources)
        summary = f"{len(sources)}件を統合伝票にまとめた(明細+鏡)"
    await audit.log_audit(
        session, firm_id=base.firm_id, client_id=base.client_id, actor_user_id=principal.user.id,
        action="merged", target_type="receipt", target_id=voucher.id, summary=summary,
    )
    await session.flush()
    await dedup.recompute_dedup(session, base.client_id)
    imgs = await _capture_images(session, voucher.id)
    creators = await _creator_names(session, [voucher])
    return {**_serialize(voucher, imgs, creators.get(voucher.created_by)), "merged": merged_n}


@router.post("/unmerge")
async def unmerge_receipts(
    body: UnmergeBody,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """統合伝票を「ばらす」: 束ねた元(merged_into=voucher)を復元して受信箱に戻し、統合伝票は削除。
    元は一切変更していないので確実に元通り。仕訳済み(確定済み)もばらせる(user要望 2026-07-22) —
    その場合は仕訳を取り消した上でばらし、復元した各元にも監査ログを残す(フロントは強い警告)。"""
    voucher = await session.get(Receipt, body.voucher_id)
    if voucher is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "統合伝票が見つかりません")
    if voucher.approval_status != ApprovalStatus.pending.value:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "処理済み(否認/削除等)の統合伝票はばらせません")
    was_journalized = voucher.journalized_at is not None
    children = list(await session.scalars(select(Receipt).where(Receipt.merged_into == voucher.id)))
    if not children:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "この領収書はマージされていません")
    for c in children:
        # ばらすとき: 統合伝票の付箋を復元する各元にも引き継ぐ(まとめ後に付けた付箋も戻す。既存は保持)。
        c.note_ids = _merge_note_ids(c.note_ids, voucher.note_ids)
        c.merged_into = None  # 元を復元(受信箱に戻る)
    if was_journalized:
        # 仕訳済みをばらす場合は仕訳も取消(deleted+journalized の行を残すと元帳に亡霊が出る)。
        voucher.journalized_at = None
    voucher.approval_status = ApprovalStatus.deleted.value  # 統合伝票は削除(消えたように)
    await audit.log_audit(
        session, firm_id=voucher.firm_id, client_id=voucher.client_id, actor_user_id=principal.user.id,
        action="unmerged", target_type="receipt", target_id=voucher.id,
        summary=(f"仕訳済みの統合伝票を取り消してばらし、{len(children)}件を復元" if was_journalized
                 else f"統合伝票をばらして{len(children)}件を復元"),
    )
    if was_journalized:
        # 統合伝票は消えるため、復元される各元の変更履歴にも痕跡を残す(電帳法の訂正削除履歴)。
        for c in children:
            await audit.log_audit(
                session, firm_id=voucher.firm_id, client_id=voucher.client_id, actor_user_id=principal.user.id,
                action="unmerged", target_type="receipt", target_id=c.id,
                summary="仕訳済みの統合伝票をばらして受信箱へ復元",
            )
    await session.flush()
    await dedup.recompute_dedup(session, voucher.client_id)
    return {"unmerged": len(children), "was_journalized": was_journalized}


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
