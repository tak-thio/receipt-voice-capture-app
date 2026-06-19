"""device_tokens(FCM登録トークン) を追加。

モバイル端末のFCMトークンをユーザー単位で保持。通知はサーバ(firebase-admin)が送る。
client-scoped RLS(own=自分のuser_id / all=管理者・経理・職員)。送信時は owner 接続で読む。

Revision ID: 0030_device_tokens
Revises: 0029_receipt_lane
"""

import sqlalchemy as sa
from alembic import op

revision = "0030_device_tokens"
down_revision = "0029_receipt_lane"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if not insp.has_table("device_tokens"):
        op.create_table(
            "device_tokens",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("firm_id", sa.Uuid(), sa.ForeignKey("firms.id", ondelete="CASCADE"), index=True),
            sa.Column("client_id", sa.Uuid(), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=True, index=True),
            sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), index=True),
            sa.Column("token", sa.Text(), nullable=False),
            sa.Column("platform", sa.String(length=20), nullable=False, server_default="android"),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("token", name="uq_device_token"),
        )
    # client-scoped RLS(own=自分のuser_id / all=管理者・経理・職員)。expense_claims と同じ作り。
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON device_tokens TO receipt_app")
    op.execute("ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE device_tokens FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS tenant_rbac ON device_tokens")
    op.execute(
        "CREATE POLICY tenant_rbac ON device_tokens FOR ALL "
        "USING (app_client_access(client_id) = 'all' "
        "  OR (app_client_access(client_id) = 'own' AND user_id = app_uid())) "
        "WITH CHECK (app_client_access(client_id) = 'all' "
        "  OR (app_client_access(client_id) = 'own' AND user_id = app_uid()))"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_rbac ON device_tokens")
    op.execute("DROP TABLE IF EXISTS device_tokens")
