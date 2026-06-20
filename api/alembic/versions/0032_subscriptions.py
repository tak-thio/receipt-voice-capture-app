"""subscriptions(アプリ内課金IAPの購読) を追加。firm単位。検証済み購入で plan=pro を付与。

Revision ID: 0032_subscriptions
Revises: 0031_firm_plan_business
"""

import sqlalchemy as sa
from alembic import op

revision = "0032_subscriptions"
down_revision = "0031_firm_plan_business"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if not insp.has_table("subscriptions"):
        op.create_table(
            "subscriptions",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("firm_id", sa.Uuid(), sa.ForeignKey("firms.id", ondelete="CASCADE"), index=True),
            sa.Column("platform", sa.String(length=20), nullable=False, server_default="google"),
            sa.Column("product_id", sa.String(length=100), nullable=False),
            sa.Column("purchase_token", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=40), nullable=False, server_default="active"),
            sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("purchase_token", name="uq_sub_token"),
        )
    # firm-scoped RLS。NULL逃しでストア通知(RTDN)等の owner 書き込みも通す。
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON subscriptions TO receipt_app")
    op.execute("ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS firm_scope ON subscriptions")
    op.execute(
        "CREATE POLICY firm_scope ON subscriptions FOR ALL "
        "USING (app_uid() IS NULL OR firm_id IN (SELECT app_firm_ids())) "
        "WITH CHECK (app_uid() IS NULL OR firm_id IN (SELECT app_firm_ids()))"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS firm_scope ON subscriptions")
    op.execute("DROP TABLE IF EXISTS subscriptions")
