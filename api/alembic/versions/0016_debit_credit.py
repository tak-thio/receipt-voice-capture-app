"""double-entry: receipts.credit_account_title_id + split pinned into debit/credit

- 仕分けを複式に: receipt.account_title_id を借方、credit_account_title_id を貸方とする。
- account_titles.pinned を借方/貸方の2フラグ (pinned_debit / pinned_credit) に分割。

Revision ID: 0016_debit_credit
Revises: 0015_account_title_pinned
"""

import sqlalchemy as sa
from alembic import op

revision = "0016_debit_credit"
down_revision = "0015_account_title_pinned"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns("account_titles")]
    # Existing DBs: 0015's single `pinned` becomes the debit flag.
    if "pinned" in cols and "pinned_debit" not in cols:
        op.alter_column("account_titles", "pinned", new_column_name="pinned_debit")
        cols = [c["name"] for c in sa.inspect(bind).get_columns("account_titles")]
    # Fresh DBs: create_all already made pinned_debit; drop the orphan `pinned` 0015 adds.
    if "pinned" in cols and "pinned_debit" in cols:
        op.drop_column("account_titles", "pinned")
        cols = [c["name"] for c in sa.inspect(bind).get_columns("account_titles")]
    if "pinned_debit" not in cols:
        op.add_column(
            "account_titles",
            sa.Column("pinned_debit", sa.Boolean, nullable=False, server_default=sa.text("false")),
        )
        cols.append("pinned_debit")
    if "pinned_credit" not in cols:
        op.add_column(
            "account_titles",
            sa.Column("pinned_credit", sa.Boolean, nullable=False, server_default=sa.text("false")),
        )

    rcols = [c["name"] for c in sa.inspect(bind).get_columns("receipts")]
    if "credit_account_title_id" not in rcols:
        op.add_column("receipts", sa.Column("credit_account_title_id", sa.Uuid(), nullable=True))


def downgrade() -> None:
    op.drop_column("receipts", "credit_account_title_id")
    op.drop_column("account_titles", "pinned_credit")
    op.alter_column("account_titles", "pinned_debit", new_column_name="pinned")
