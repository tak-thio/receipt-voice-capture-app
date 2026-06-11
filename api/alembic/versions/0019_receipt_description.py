"""receipts: 摘要 (description) — 仕訳の説明。AI が生成し、手修正もできる。

Revision ID: 0019_receipt_description
Revises: 0018_tax_rate_breakdown
"""

import sqlalchemy as sa
from alembic import op

revision = "0019_receipt_description"
down_revision = "0018_tax_rate_breakdown"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = [c["name"] for c in sa.inspect(op.get_bind()).get_columns("receipts")]
    if "description" not in cols:
        op.add_column("receipts", sa.Column("description", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("receipts", "description")
