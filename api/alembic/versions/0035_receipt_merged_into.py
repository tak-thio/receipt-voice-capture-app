"""receipts.merged_into を追加。マージ(明細+鏡)の統合伝票に元領収書を紐付ける。

merged_into が非NULL = 統合伝票(親)に束ねられた元(受信箱で隠す・全集計の対象外)。
統合伝票を削除すれば ondelete=SET NULL で元が復元される(ばらす)。

Revision ID: 0035_receipt_merged_into
Revises: 0034_drive_connections
"""

import sqlalchemy as sa
from alembic import op

revision = "0035_receipt_merged_into"
down_revision = "0034_drive_connections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    cols = [c["name"] for c in insp.get_columns("receipts")]
    if "merged_into" not in cols:
        op.add_column(
            "receipts",
            sa.Column(
                "merged_into",
                sa.Uuid(),
                sa.ForeignKey("receipts.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index("ix_receipts_merged_into", "receipts", ["merged_into"])


def downgrade() -> None:
    op.drop_index("ix_receipts_merged_into", table_name="receipts")
    op.drop_column("receipts", "merged_into")
