"""receipts: partner_name — 取引先(自由入力)。マスタ完全一致なら partner_id を引当、
無ければこのテキストを取引先として使う(店舗名 vendor とは別に保持)。

Revision ID: 0023_receipt_partner_name
Revises: 0022_receipt_doc_type
"""

import sqlalchemy as sa
from alembic import op

revision = "0023_receipt_partner_name"
down_revision = "0022_receipt_doc_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = [c["name"] for c in sa.inspect(op.get_bind()).get_columns("receipts")]
    if "partner_name" not in cols:
        op.add_column("receipts", sa.Column("partner_name", sa.String(length=300), nullable=True))


def downgrade() -> None:
    op.drop_column("receipts", "partner_name")
