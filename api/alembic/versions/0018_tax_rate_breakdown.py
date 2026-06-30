"""receipts: 消費税の税率別内訳 (tax_10_jpy 10%分 / tax_8_jpy 8%分)

Revision ID: 0018_tax_rate_breakdown
Revises: 0017_receipt_tax_breakdown
"""

import sqlalchemy as sa
from alembic import op

revision = "0018_tax_rate_breakdown"
down_revision = "0017_receipt_tax_breakdown"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = [c["name"] for c in sa.inspect(op.get_bind()).get_columns("receipts")]
    if "tax_10_jpy" not in cols:
        op.add_column("receipts", sa.Column("tax_10_jpy", sa.BigInteger(), nullable=True))
    if "tax_8_jpy" not in cols:
        op.add_column("receipts", sa.Column("tax_8_jpy", sa.BigInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("receipts", "tax_8_jpy")
    op.drop_column("receipts", "tax_10_jpy")
