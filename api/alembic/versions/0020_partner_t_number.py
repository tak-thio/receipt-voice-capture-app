"""partners: T番号(インボイス登録番号) — 取引先=登録事業者の単位で持ち、完全一致引当のキーにする。

Revision ID: 0020_partner_t_number
Revises: 0019_receipt_description
"""

import sqlalchemy as sa
from alembic import op

revision = "0020_partner_t_number"
down_revision = "0019_receipt_description"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = [c["name"] for c in sa.inspect(op.get_bind()).get_columns("partners")]
    if "t_number" not in cols:
        op.add_column("partners", sa.Column("t_number", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("partners", "t_number")
