"""receipts.capture_meta: モバイルのキャプチャ時メタデータ(JSONB)

撮影時刻・画像寸法・検出(bbox/score/label)・プラットフォーム等を、AI 処理前の
原情報として保持する。標準モードの抽出には影響しない(linked モードの /captures 用)。

Revision ID: 0012_capture_meta
Revises: 0011_backfill_client_charts
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0012_capture_meta"
down_revision = "0011_backfill_client_charts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "receipts",
        sa.Column(
            "capture_meta",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("receipts", "capture_meta")
