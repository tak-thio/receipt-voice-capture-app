"""receipts.card_batch_id を追加(クレジット明細の取込バッチ=塊)。

同じ取込(=同じ明細ファイル)の全明細行が同じ card_batch_id(UUID)を共有する。
受信箱に「塊」で1行表示し、その単位で一括削除するためのキー。
既存データの後付け(backfill)は本マイグレーションでは行わない(別途スクリプトで安全に実施)。

Revision ID: 0036_card_batch_id
Revises: 0035_receipt_merged_into
"""

import sqlalchemy as sa
from alembic import op

revision = "0036_card_batch_id"
down_revision = "0035_receipt_merged_into"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    cols = [c["name"] for c in insp.get_columns("receipts")]
    if "card_batch_id" not in cols:
        op.add_column("receipts", sa.Column("card_batch_id", sa.Uuid(), nullable=True))
        op.create_index("ix_receipts_card_batch_id", "receipts", ["card_batch_id"])


def downgrade() -> None:
    op.drop_index("ix_receipts_card_batch_id", table_name="receipts")
    op.drop_column("receipts", "card_batch_id")
