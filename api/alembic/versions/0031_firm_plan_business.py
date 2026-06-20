"""既存の事務所(B2B)を plan=business に移行(月間解析枚数の上限対象外)。

新規の個人サインアップは free で作る。この移行をやらないと、既存事務所が無料枠(30枚/月)で
止まってしまう。既存 firm は全て会社(B2B)なので一律 business にする。

Revision ID: 0031_firm_plan_business
Revises: 0030_device_tokens
"""

from alembic import op

revision = "0031_firm_plan_business"
down_revision = "0030_device_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE firms SET plan = 'business' WHERE plan IS NULL OR plan <> 'business'")


def downgrade() -> None:
    # どの firm が元々 free だったか復元できないため no-op。
    pass
