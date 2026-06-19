"""SQLAlchemy models for the multi-tenant receipt SaaS.

Tenant hierarchy: firm (税理士事務所) -> client (顧問先) -> receipts/masters.
Every tenant-scoped table carries firm_id (and client_id where applicable);
isolation is enforced by Postgres RLS (see alembic 0001), not by app code.
"""

from __future__ import annotations

import enum
from datetime import date, datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

# Placeholder vendor for a receipt uploaded but not yet AI-parsed. The worker
# replaces it once OCR/format extracts the real vendor.
UNPARSED_VENDOR = "未解析"


# --- enums -----------------------------------------------------------------

class Role(str, enum.Enum):
    firm_owner = "firm_owner"      # 管理者(職員): 全顧問先・事務所管理
    firm_staff = "firm_staff"      # 一般社員(職員): 担当顧問先のみ(staff_clients で割当)
    client_admin = "client_admin"  # 管理者(利用者): 自顧問先の全データ + ユーザー管理
    client_accountant = "client_accountant"  # 経理担当者: 自顧問先の全データ閲覧
    client_user = "client_user"    # 一般社員(利用者): 自分が登録したデータのみ


class ReceiptSource(str, enum.Enum):
    mobile = "mobile"
    gmail = "gmail"
    card = "card"
    manual = "manual"


class ApprovalStatus(str, enum.Enum):
    pending = "pending"
    rejected = "rejected"   # 否認
    mistake = "mistake"     # 間違い
    deleted = "deleted"     # 削除
    duplicate = "duplicate"


class ReceiptLane(str, enum.Enum):
    """領収書の処理レーン。company=会社経費(受信箱→仕分け→突き合わせ)、
    expense=立替経費(経費精算で承認されるまで会社の記帳に入らない)。"""
    company = "company"
    expense = "expense"


# --- mixins ----------------------------------------------------------------

def _uuid_pk() -> Mapped[UUID]:
    return mapped_column(primary_key=True, default=uuid4)


class TimestampMixin:
    # Python-side default (not server_default) so INSERTs don't need a RETURNING,
    # which would otherwise be filtered by the SELECT RLS policy and reject a
    # freshly-inserted row that the actor can't yet see (e.g. a new user before
    # its membership exists).
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


# --- tenancy / identity ----------------------------------------------------

class Firm(Base, TimestampMixin):
    __tablename__ = "firms"

    id: Mapped[UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String(200))
    # { stt:{provider,key_enc?}, ocr:{provider,key_enc?}, format:{provider,key_enc?} }
    ai_config: Mapped[dict] = mapped_column(JSONB, default=dict)
    plan: Mapped[str] = mapped_column(String(50), default="free")
    status: Mapped[str] = mapped_column(String(50), default="active")


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    job_title: Mapped[str | None] = mapped_column(String(100), nullable=True)  # 役職 (代表取締役/部長 等)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | disabled
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Operator(Base, TimestampMixin):
    """Platform operator (運営): provisions and manages 税理士事務所 (firms).

    Deliberately separate from tenant `users`: an operator has NO membership and
    therefore no RLS access to any tenant's receipt/client data. It can only act
    through the operator endpoints (create/list/manage firms). This is the
    account that bootstraps and administers the SaaS itself, one level above
    firm_owner.
    """

    __tablename__ = "operators"

    id: Mapped[UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | disabled
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Client(Base, TimestampMixin):
    __tablename__ = "clients"

    id: Mapped[UUID] = _uuid_pk()
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    # Per-client AI provider override (same shape as Firm.ai_config). Resolved as
    # client > firm in the worker. Keys are Fernet-encrypted; never returned raw.
    ai_config: Mapped[dict] = mapped_column(JSONB, default=dict)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    export_default: Mapped[str] = mapped_column(String(50), default="generic")
    status: Mapped[str] = mapped_column(String(50), default="active")
    # Extended master fields.
    entity_type: Mapped[str | None] = mapped_column(String(20), nullable=True)  # corporation | individual
    t_number: Mapped[str | None] = mapped_column(String(20), nullable=True)  # インボイス登録番号
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    contact_name: Mapped[str | None] = mapped_column(String(100), nullable=True)  # 先方担当者
    fiscal_month: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 決算月 1-12
    # 締め日(ロック日): この日付以前(同日含む)の取引日の領収書は受信箱/仕分けで「期間外」警告。
    closing_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # 経費精算機能の顧問先ごとON/OFF + 承認時に作る仕訳の既定貸方科目(未払金 等)。
    expense_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    expense_credit_account_title_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("account_titles.id"), nullable=True
    )
    industry: Mapped[str | None] = mapped_column(String(100), nullable=True)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    staff_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )  # 担当職員


class StaffClient(Base, TimestampMixin):
    """n:n assignment of a firm staff (一般社員) to the 顧問先 they handle.

    firm_owner sees all clients; a firm_staff sees only their assigned clients
    (enforced by app_client_access() in RLS).
    """

    __tablename__ = "staff_clients"
    __table_args__ = (UniqueConstraint("user_id", "client_id"),)

    id: Mapped[UUID] = _uuid_pk()
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)


class Membership(Base, TimestampMixin):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("user_id", "firm_id", "client_id"),)

    id: Mapped[UUID] = _uuid_pk()
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"), index=True)
    # NULL = firm-level membership (sees all clients in the firm).
    client_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=True, index=True
    )
    role: Mapped[str] = mapped_column(String(30))


# --- mobile pairing / sessions --------------------------------------------

class PairingToken(Base, TimestampMixin):
    """One-time token rendered as a QR for mobile onboarding."""

    __tablename__ = "pairing_tokens"

    id: Mapped[UUID] = _uuid_pk()
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"))
    client_id: Mapped[UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(255), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DeviceSession(Base, TimestampMixin):
    """Long-lived session bound to a paired device (refresh token)."""

    __tablename__ = "device_sessions"

    id: Mapped[UUID] = _uuid_pk()
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"))
    refresh_token_hash: Mapped[str] = mapped_column(String(255), index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Invite(Base, TimestampMixin):
    """Invite to join a firm (as staff) or a client (as 事務員/入力者) via a link.

    The invitee opens the link and sets their own email + password — no email
    delivery required (the admin shares the link). Looked up by token at redeem,
    so (like pairing_tokens) it is not RLS-bound.
    """

    __tablename__ = "invites"

    id: Mapped[UUID] = _uuid_pk()
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=True
    )
    role: Mapped[str] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    token_hash: Mapped[str] = mapped_column(String(255), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)


# --- files / receipts ------------------------------------------------------

class File(Base, TimestampMixin):
    __tablename__ = "files"

    id: Mapped[UUID] = _uuid_pk()
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # image | audio | pdf
    path: Mapped[str] = mapped_column(String(500))  # object storage key
    size: Mapped[int] = mapped_column(BigInteger, default=0)
    mime: Mapped[str] = mapped_column(String(100), default="")
    filename: Mapped[str | None] = mapped_column(String(400), nullable=True)  # 元のファイル名(表示用)
    uploaded_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class Receipt(Base, TimestampMixin):
    __tablename__ = "receipts"

    id: Mapped[UUID] = _uuid_pk()
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(20), default=ReceiptSource.mobile.value)
    # 書類種別: 通常の領収書 'receipt' か、クレジットカード利用明細の1行 'card_statement'。
    # 1枚の画像/明細から複数 Receipt を起こすとき、行/明細の性格を区別する。
    doc_type: Mapped[str] = mapped_column(String(20), default="receipt", server_default="receipt")
    # 処理レーン: company=会社経費(受信箱→仕分け→突き合わせ) / expense=立替経費(経費精算)。
    # 一般社員が取り込んだものは expense。expense は承認まで会社の記帳(受信箱/仕分け/突き合わせ)に出ない。
    lane: Mapped[str] = mapped_column(
        String(20), default=ReceiptLane.company.value, server_default="company", index=True
    )

    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    vendor: Mapped[str | None] = mapped_column(String(300), nullable=True)  # 店舗名(支払先・OCR生)
    # 取引先(自由入力)。マスタに完全一致すれば partner_id を引当、無ければこのテキストを使う。
    partner_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    amount_jpy: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # 合計金額(税込)
    subtotal_jpy: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # 税抜金額
    tax_jpy: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # 消費税合計
    tax_10_jpy: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # 消費税(10%対象分)
    tax_8_jpy: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # 消費税(8%対象分)
    tax_mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(50), nullable=True)
    t_number: Mapped[str | None] = mapped_column(String(20), nullable=True)  # インボイス番号
    description: Mapped[str | None] = mapped_column(Text, nullable=True)  # 摘要 (仕訳の説明。AI生成 + 手修正可)
    # 自由メモ。取込時に「ファイル名/ページ/音声の文字起こし」を初期値で入れ、以後自由に編集可。
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)

    account_title_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("account_titles.id"), nullable=True
    )  # 借方科目 (debit)
    credit_account_title_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("account_titles.id"), nullable=True
    )  # 貸方科目 (credit)
    sub_account_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("sub_accounts.id"), nullable=True
    )
    partner_id: Mapped[UUID | None] = mapped_column(ForeignKey("partners.id"), nullable=True)

    stt_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    ocr_raw: Mapped[str | None] = mapped_column(Text, nullable=True)

    approval_status: Mapped[str] = mapped_column(String(20), default=ApprovalStatus.pending.value)
    journalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    journal_hold: Mapped[bool] = mapped_column(Boolean, default=False)
    match_id: Mapped[UUID | None] = mapped_column(nullable=True, index=True)
    created_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # 付箋 (note) ids attached to this receipt — UUID strings into the notes master.
    note_ids: Mapped[list] = mapped_column(JSONB, default=list)
    # モバイル端末のキャプチャ時メタデータ(撮影時刻・画像寸法・検出情報・プラットフォーム等)。
    capture_meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    # search_text (generated column + pg_trgm GIN index) is added in the migration.

    files: Mapped[list[ReceiptFile]] = relationship(cascade="all, delete-orphan")


class ReceiptFile(Base):
    __tablename__ = "receipt_files"

    id: Mapped[UUID] = _uuid_pk()
    receipt_id: Mapped[UUID] = mapped_column(ForeignKey("receipts.id", ondelete="CASCADE"), index=True)
    file_id: Mapped[UUID] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(20))  # capture | audio | attachment


class AuditLog(Base):
    """append-only 監査ログ。電子帳簿保存法の訂正削除履歴＋各操作の証跡。
    target_id は FK にしない(対象が削除されても履歴を残す)。アプリ権限では INSERT/SELECT のみ
    (UPDATE/DELETE 不可=改ざん防止)。client-scoped RLS。"""

    __tablename__ = "audit_logs"

    id: Mapped[UUID] = _uuid_pk()
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=True, index=True
    )
    actor_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(40))  # updated/deleted/journalized/approved/...
    target_type: Mapped[str] = mapped_column(String(40), index=True)  # receipt/expense_claim/...
    target_id: Mapped[UUID] = mapped_column(index=True)  # 対象ID(FKにしない=削除後も残す)
    summary: Mapped[str | None] = mapped_column(String(500), nullable=True)
    changes: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # {field: {before, after}}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ExpenseClaim(Base, TimestampMixin):
    """経費精算の申請。既存の取込済み領収書(items)を束ねて申請→承認/否認。支払い実行はしない。"""

    __tablename__ = "expense_claims"

    id: Mapped[UUID] = _uuid_pk()
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    applicant_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # draft → submitted → approved | rejected ; submitted/draft → withdrawn ; rejected → (再提出で) submitted
    status: Mapped[str] = mapped_column(String(20), default="draft")
    approver_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    items: Mapped[list["ExpenseClaimItem"]] = relationship(cascade="all, delete-orphan")


class ExpenseClaimItem(Base):
    """申請に束ねた1領収書。RLS用に client_id / applicant_user_id を持つ(claim と同じ所有者判定)。"""

    __tablename__ = "expense_claim_items"

    id: Mapped[UUID] = _uuid_pk()
    claim_id: Mapped[UUID] = mapped_column(ForeignKey("expense_claims.id", ondelete="CASCADE"), index=True)
    receipt_id: Mapped[UUID] = mapped_column(ForeignKey("receipts.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    applicant_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)


# --- masters ---------------------------------------------------------------
# Account titles / sub-accounts: firm template (client_id NULL) + client override.
# Partners / aliases / rules: per-client (learned from that client's receipts).

class AccountTitle(Base, TimestampMixin):
    __tablename__ = "account_titles"

    id: Mapped[UUID] = _uuid_pk()
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=True, index=True
    )
    code: Mapped[str] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(200))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    # 「よく使う」科目: 仕分けで既定表示する。借方/貸方で別々に指定する。
    pinned_debit: Mapped[bool] = mapped_column(Boolean, default=False)
    pinned_credit: Mapped[bool] = mapped_column(Boolean, default=False)
    # When a client row supersedes/hides a firm-template row.
    override_of: Mapped[UUID | None] = mapped_column(
        ForeignKey("account_titles.id"), nullable=True
    )


class SubAccount(Base, TimestampMixin):
    __tablename__ = "sub_accounts"

    id: Mapped[UUID] = _uuid_pk()
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("clients.id", ondelete="CASCADE"), nullable=True, index=True
    )
    account_title_id: Mapped[UUID] = mapped_column(ForeignKey("account_titles.id", ondelete="CASCADE"))
    code: Mapped[str] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(200))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    override_of: Mapped[UUID | None] = mapped_column(ForeignKey("sub_accounts.id"), nullable=True)


class Note(Base, TimestampMixin):
    """付箋: a free-text + colour label, defined per client, attachable to
    receipts (see Receipt.note_ids). Examples: 「社長に確認」「井出さんに確認」."""

    __tablename__ = "notes"

    id: Mapped[UUID] = _uuid_pk()
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(String(100))
    color: Mapped[str] = mapped_column(String(20), default="amber")  # palette key
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Partner(Base, TimestampMixin):
    __tablename__ = "partners"

    id: Mapped[UUID] = _uuid_pk()
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    name: Mapped[str] = mapped_column(String(200))
    # インボイス登録番号(T番号)。取引先=適格請求書発行事業者の単位で持つ。
    # 領収書のT番号と完全一致したら自動引当のキーになる。
    t_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class PartnerAlias(Base, TimestampMixin):
    __tablename__ = "partner_aliases"
    __table_args__ = (UniqueConstraint("client_id", "raw_vendor"),)

    id: Mapped[UUID] = _uuid_pk()
    client_id: Mapped[UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    raw_vendor: Mapped[str] = mapped_column(String(300))
    partner_id: Mapped[UUID] = mapped_column(ForeignKey("partners.id", ondelete="CASCADE"))


class JournalRule(Base, TimestampMixin):
    __tablename__ = "journal_rules"

    id: Mapped[UUID] = _uuid_pk()
    client_id: Mapped[UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    # Mobile receipts learn by normalized vendor; gmail/card by from_addr/subject.
    vendor_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    from_addr: Mapped[str | None] = mapped_column(String(320), nullable=True)
    subject_keyword: Mapped[str | None] = mapped_column(String(200), nullable=True)
    account_title_id: Mapped[UUID | None] = mapped_column(ForeignKey("account_titles.id"), nullable=True)
    sub_account_id: Mapped[UUID | None] = mapped_column(ForeignKey("sub_accounts.id"), nullable=True)
    partner_id: Mapped[UUID | None] = mapped_column(ForeignKey("partners.id"), nullable=True)
    hit_count: Mapped[int] = mapped_column(Integer, default=0)


# --- jobs ------------------------------------------------------------------

class Job(Base, TimestampMixin):
    __tablename__ = "jobs"

    id: Mapped[UUID] = _uuid_pk()
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[UUID | None] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), nullable=True)
    kind: Mapped[str] = mapped_column(String(40))  # stt | ocr | format | card_ocr | gmail_ingest
    status: Mapped[str] = mapped_column(String(20), default="pending")
    params: Mapped[dict] = mapped_column(JSONB, default=dict)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


# --- Gmail 取り込み ----------------------------------------------------------

class GmailAccount(Base, TimestampMixin):
    """顧問先(client)に紐付く Gmail メールボックス。顧客のユーザーが「連携」して登録。
    そのメールに届いた領収書(添付/本文)は client_id の受信箱に取り込まれる。
    トークンは Fernet で暗号化して保存(AIキーと同方式)。"""

    __tablename__ = "gmail_accounts"
    __table_args__ = (UniqueConstraint("client_id", "email", name="uq_gmail_accounts_client_email"),)

    id: Mapped[UUID] = _uuid_pk()
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(255))
    auth_type: Mapped[str] = mapped_column(String(8), default="oauth")  # oauth | dwd
    access_token_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    refresh_token_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    scopes: Mapped[str] = mapped_column(String(1024), default="")
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    connected_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class GmailMessage(Base):
    """取り込み済みメールの記録(重複排除＆突合)。msg_id はアカウント内で一意。"""

    __tablename__ = "gmail_messages"
    __table_args__ = (UniqueConstraint("account_id", "msg_id", name="uq_gmail_messages_account_msg"),)

    id: Mapped[UUID] = _uuid_pk()
    client_id: Mapped[UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[UUID] = mapped_column(ForeignKey("gmail_accounts.id", ondelete="CASCADE"), index=True)
    msg_id: Mapped[str] = mapped_column(String(255))  # Gmail のメッセージID
    message_id: Mapped[str | None] = mapped_column(String(998), nullable=True)  # RFC822 Message-ID
    receipt_id: Mapped[UUID | None] = mapped_column(ForeignKey("receipts.id", ondelete="SET NULL"), nullable=True)
    internal_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
