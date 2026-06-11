"""receipts: 消費税の内訳 (subtotal_jpy 税抜 / tax_jpy 消費税額)

Revision ID: 0017_receipt_tax_breakdown
Revises: 0016_debit_credit
"""

import sqlalchemy as sa
from alembic import op

revision = "0017_receipt_tax_breakdown"
down_revision = "0016_debit_credit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = [c["name"] for c in sa.inspect(op.get_bind()).get_columns("receipts")]
    if "subtotal_jpy" not in cols:
        op.add_column("receipts", sa.Column("subtotal_jpy", sa.BigInteger(), nullable=True))
    if "tax_jpy" not in cols:
        op.add_column("receipts", sa.Column("tax_jpy", sa.BigInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("receipts", "tax_jpy")
    op.drop_column("receipts", "subtotal_jpy")
