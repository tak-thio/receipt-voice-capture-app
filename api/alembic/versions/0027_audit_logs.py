"""audit_logs(append-only 監査ログ): 電子帳簿保存法の訂正削除履歴＋操作証跡。

client-scoped RLS(notes/gmail と同じ app_client_access ベース)。
アプリDBロール receipt_app には SELECT/INSERT のみ付与(UPDATE/DELETE 不可=改ざん防止)。

Revision ID: 0027_audit_logs
Revises: 0026_client_closing_date
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0027_audit_logs"
down_revision = "0026_client_closing_date"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if not insp.has_table("audit_logs"):
        op.create_table(
            "audit_logs",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("firm_id", sa.Uuid(), sa.ForeignKey("firms.id", ondelete="CASCADE"), index=True),
            sa.Column("client_id", sa.Uuid(), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=True, index=True),
            sa.Column("actor_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("action", sa.String(length=40), nullable=False),
            sa.Column("target_type", sa.String(length=40), nullable=False, index=True),
            sa.Column("target_id", sa.Uuid(), nullable=False, index=True),
            sa.Column("summary", sa.String(length=500), nullable=True),
            sa.Column("changes", postgresql.JSONB(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    # append-only: SELECT/INSERT のみ(UPDATE/DELETE は付与しない=改ざん防止)。client-scoped RLS。
    op.execute("GRANT SELECT, INSERT ON audit_logs TO receipt_app")
    op.execute("ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS tenant_rbac ON audit_logs")
    op.execute(
        "CREATE POLICY tenant_rbac ON audit_logs FOR ALL "
        "USING (app_client_access(audit_logs.client_id) <> 'none') "
        "WITH CHECK (app_client_access(audit_logs.client_id) <> 'none')"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_rbac ON audit_logs")
    op.execute("DROP TABLE IF EXISTS audit_logs")
