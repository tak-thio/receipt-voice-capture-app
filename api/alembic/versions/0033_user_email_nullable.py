"""個人プランの「匿名スタート」用に users.email を nullable 化する。

メール/パスワード無しで始められるようにし(離脱を減らす)、後から /individual/claim で
メールを結びつける(遅延サインアップ)。unique 制約は維持する — Postgres は NULL を重複と
見なさないので、メール未登録(匿名)のユーザーは何件でも作れる。

Revision ID: 0033_user_email_nullable
Revises: 0032_subscriptions
"""

import sqlalchemy as sa
from alembic import op

revision = "0033_user_email_nullable"
down_revision = "0032_subscriptions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("users", "email", existing_type=sa.String(320), nullable=True)


def downgrade() -> None:
    # NULL の email を持つ匿名ユーザーがいると失敗する(その場合は先に該当行を整理すること)。
    op.alter_column("users", "email", existing_type=sa.String(320), nullable=False)
