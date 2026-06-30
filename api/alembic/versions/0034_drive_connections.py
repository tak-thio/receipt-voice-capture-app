"""drive_connections(個人の Google Drive 連携トークン) を追加。firm単位。エクスポート書き出し用。

トークンは Fernet 暗号化して保存(Gmail/AIキーと同方式)。firm-scoped RLS。

Revision ID: 0034_drive_connections
Revises: 0033_user_email_nullable
"""

import sqlalchemy as sa
from alembic import op

revision = "0034_drive_connections"
down_revision = "0033_user_email_nullable"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if not insp.has_table("drive_connections"):
        op.create_table(
            "drive_connections",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("firm_id", sa.Uuid(), sa.ForeignKey("firms.id", ondelete="CASCADE"), index=True),
            sa.Column("refresh_token_enc", sa.Text(), nullable=True),
            sa.Column("access_token_enc", sa.Text(), nullable=True),
            sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("scopes", sa.String(length=1024), nullable=False, server_default=""),
            sa.Column("connected_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("firm_id", name="uq_drive_firm"),
        )
    # firm-scoped RLS(subscriptions と同方式)。NULL逃しで owner 書き込みも通す。
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON drive_connections TO receipt_app")
    op.execute("ALTER TABLE drive_connections ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE drive_connections FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS firm_scope ON drive_connections")
    op.execute(
        "CREATE POLICY firm_scope ON drive_connections FOR ALL "
        "USING (app_uid() IS NULL OR firm_id IN (SELECT app_firm_ids())) "
        "WITH CHECK (app_uid() IS NULL OR firm_id IN (SELECT app_firm_ids()))"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS firm_scope ON drive_connections")
    op.execute("DROP TABLE IF EXISTS drive_connections")
