"""receipts.memo(自由メモ) + files.filename(元のファイル名)。

メモは取込時に「ファイル名 / ページ / 音声の文字起こし」を初期値として入れ、以後ユーザーが
自由に編集できる(消してもよい)。filename は「どのファイル由来か」を出すために保存する。

Revision ID: 0025_receipt_memo
Revises: 0024_receipt_parse_failed
"""

import sqlalchemy as sa
from alembic import op

revision = "0025_receipt_memo"
down_revision = "0024_receipt_parse_failed"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    rcols = [c["name"] for c in sa.inspect(bind).get_columns("receipts")]
    if "memo" not in rcols:
        op.add_column("receipts", sa.Column("memo", sa.Text(), nullable=True))
    fcols = [c["name"] for c in sa.inspect(bind).get_columns("files")]
    if "filename" not in fcols:
        op.add_column("files", sa.Column("filename", sa.String(length=400), nullable=True))


def downgrade() -> None:
    op.drop_column("receipts", "memo")
    op.drop_column("files", "filename")
