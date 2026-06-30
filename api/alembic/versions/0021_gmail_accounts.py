"""Gmail 取り込み: gmail_accounts(顧問先に紐付くメールボックス) + gmail_messages(取込済み記録)

client-scoped RLS(partners/notes と同じ app_client_access ベース)。

Revision ID: 0021_gmail_accounts
Revises: 0020_partner_t_number
"""

import sqlalchemy as sa
from alembic import op

revision = "0021_gmail_accounts"
down_revision = "0020_partner_t_number"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())

    if not insp.has_table("gmail_accounts"):
        op.create_table(
            "gmail_accounts",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("firm_id", sa.Uuid(), sa.ForeignKey("firms.id", ondelete="CASCADE"), index=True),
            sa.Column("client_id", sa.Uuid(), sa.ForeignKey("clients.id", ondelete="CASCADE"), index=True),
            sa.Column("email", sa.String(length=255), nullable=False),
            sa.Column("auth_type", sa.String(length=8), nullable=False, server_default="oauth"),
            sa.Column("access_token_enc", sa.Text(), nullable=True),
            sa.Column("refresh_token_enc", sa.Text(), nullable=True),
            sa.Column("scopes", sa.String(length=1024), nullable=False, server_default=""),
            sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("connected_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("client_id", "email", name="uq_gmail_accounts_client_email"),
        )

    if not insp.has_table("gmail_messages"):
        op.create_table(
            "gmail_messages",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("client_id", sa.Uuid(), sa.ForeignKey("clients.id", ondelete="CASCADE"), index=True),
            sa.Column("account_id", sa.Uuid(), sa.ForeignKey("gmail_accounts.id", ondelete="CASCADE"), index=True),
            sa.Column("msg_id", sa.String(length=255), nullable=False),
            sa.Column("message_id", sa.String(length=998), nullable=True),
            sa.Column("receipt_id", sa.Uuid(), sa.ForeignKey("receipts.id", ondelete="SET NULL"), nullable=True),
            sa.Column("internal_date", sa.DateTime(timezone=True), nullable=True),
            sa.Column("processed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("account_id", "msg_id", name="uq_gmail_messages_account_msg"),
        )

    # 権限 + client-scoped RLS(notes/partners と同じ)。常に(再)適用。
    for tbl in ("gmail_accounts", "gmail_messages"):
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {tbl} TO receipt_app")
        op.execute(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {tbl} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS tenant_rbac ON {tbl}")
        op.execute(
            f"CREATE POLICY tenant_rbac ON {tbl} FOR ALL "
            f"USING (app_client_access({tbl}.client_id) <> 'none') "
            f"WITH CHECK (app_client_access({tbl}.client_id) <> 'none')"
        )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_rbac ON gmail_messages")
    op.execute("DROP POLICY IF EXISTS tenant_rbac ON gmail_accounts")
    op.execute("DROP TABLE IF EXISTS gmail_messages")
    op.execute("DROP TABLE IF EXISTS gmail_accounts")
