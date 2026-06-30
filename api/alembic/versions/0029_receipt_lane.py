"""receipts.lane(処理レーン) を追加。

company=会社経費(受信箱→仕分け→突き合わせ)、expense=立替経費(経費精算)。
一般社員(client_user)が取り込んだものは expense。既存データは作成者ロールで backfill。

Revision ID: 0029_receipt_lane
Revises: 0028_expense_claims
"""

import sqlalchemy as sa
from alembic import op

revision = "0029_receipt_lane"
down_revision = "0028_expense_claims"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    cols = {c["name"] for c in insp.get_columns("receipts")}
    if "lane" not in cols:
        op.add_column(
            "receipts",
            sa.Column("lane", sa.String(length=20), nullable=False, server_default="company"),
        )
    idx = {i["name"] for i in insp.get_indexes("receipts")}
    if "ix_receipts_lane" not in idx:
        op.create_index("ix_receipts_lane", "receipts", ["lane"])
    # 既存データ: 一般社員(client_user)が取り込んだ領収書を立替(expense)に振り分ける。
    op.execute(
        """
        UPDATE receipts r SET lane = 'expense'
        FROM memberships m
        WHERE m.user_id = r.created_by
          AND m.client_id = r.client_id
          AND m.role = 'client_user'
        """
    )


def downgrade() -> None:
    op.drop_index("ix_receipts_lane", table_name="receipts")
    op.drop_column("receipts", "lane")
