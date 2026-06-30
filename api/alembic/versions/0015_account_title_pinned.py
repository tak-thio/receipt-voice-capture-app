"""account_titles.pinned — 「よく使う」科目フラグ

仕分け画面で既定表示する科目を絞るためのフラグ。マスタでトグルし、仕分けは
pinned のみを既定表示（なければ全件）。

Revision ID: 0015_account_title_pinned
Revises: 0014_client_ai_config
"""

import sqlalchemy as sa
from alembic import op

revision = "0015_account_title_pinned"
down_revision = "0014_client_ai_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: a FRESH db's 0001 create_all already added it from the ORM model.
    cols = [c["name"] for c in sa.inspect(op.get_bind()).get_columns("account_titles")]
    if "pinned" not in cols:
        op.add_column(
            "account_titles",
            sa.Column("pinned", sa.Boolean, nullable=False, server_default=sa.text("false")),
        )


def downgrade() -> None:
    op.drop_column("account_titles", "pinned")
