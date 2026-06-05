"""SQLAlchemy models for the multi-tenant receipt SaaS.

Tenant hierarchy: firm (税理士事務所) -> client (顧問先) -> receipts/masters.
Every tenant-scoped table carries firm_id (and client_id where applicable);
isolation is enforced by Postgres RLS (see alembic 0001), not by app code.
"""

from __future__ import annotations

import enum
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
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


# --- enums -----------------------------------------------------------------

class Role(str, enum.Enum):
    firm_owner = "firm_owner"     # 事務所オーナー: 顧問先/職員/AIキー/課金
    firm_staff = "firm_staff"     # 職員: 担当顧問先を横断
    client_admin = "client_admin"  # 顧問先管理者
    client_user = "client_user"   # 顧問先入力者(スマホ中心)


class ReceiptSource(str, enum.Enum):
    mobile = "mobile"
    gmail = "gmail"
    card = "card"
    manual = "manual"


class ApprovalStatus(str, enum.Enum):
    pending = "pending"
    rejected = "rejected"
    mistake = "mistake"
    duplicate = "duplicate"


# --- mixins ----------------------------------------------------------------

def _uuid_pk() -> Mapped[UUID]:
    return mapped_column(primary_key=True, default=uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
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
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Client(Base, TimestampMixin):
    __tablename__ = "clients"

    id: Mapped[UUID] = _uuid_pk()
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    export_default: Mapped[str] = mapped_column(String(50), default="generic")
    status: Mapped[str] = mapped_column(String(50), default="active")


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
    uploaded_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class Receipt(Base, TimestampMixin):
    __tablename__ = "receipts"

    id: Mapped[UUID] = _uuid_pk()
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(20), default=ReceiptSource.mobile.value)

    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    vendor: Mapped[str | None] = mapped_column(String(300), nullable=True)
    amount_jpy: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    tax_mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(50), nullable=True)
    t_number: Mapped[str | None] = mapped_column(String(20), nullable=True)  # インボイス番号

    account_title_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("account_titles.id"), nullable=True
    )
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
    # search_text (generated column + pg_trgm GIN index) is added in the migration.

    files: Mapped[list[ReceiptFile]] = relationship(cascade="all, delete-orphan")


class ReceiptFile(Base):
    __tablename__ = "receipt_files"

    id: Mapped[UUID] = _uuid_pk()
    receipt_id: Mapped[UUID] = mapped_column(ForeignKey("receipts.id", ondelete="CASCADE"), index=True)
    file_id: Mapped[UUID] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(20))  # capture | audio | attachment


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


class Partner(Base, TimestampMixin):
    __tablename__ = "partners"

    id: Mapped[UUID] = _uuid_pk()
    firm_id: Mapped[UUID] = mapped_column(ForeignKey("firms.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    name: Mapped[str] = mapped_column(String(200))
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
