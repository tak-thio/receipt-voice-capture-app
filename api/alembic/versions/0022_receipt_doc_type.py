"""receipts: doc_type — 'receipt' か 'card_statement'(カード利用明細の1行)。
1枚の画像/明細から複数 Receipt を起こすときに行/明細の性格を区別する。

Revision ID: 0022_receipt_doc_type
Revises: 0021_gmail_accounts
"""

import sqlalchemy as sa
from alembic import op

revision = "0022_receipt_doc_type"
down_revision = "0021_gmail_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = [c["name"] for c in sa.inspect(op.get_bind()).get_columns("receipts")]
    if "doc_type" not in cols:
        op.add_column(
            "receipts",
            sa.Column("doc_type", sa.String(length=20), nullable=False, server_default="receipt"),
        )


def downgrade() -> None:
    op.drop_column("receipts", "doc_type")
