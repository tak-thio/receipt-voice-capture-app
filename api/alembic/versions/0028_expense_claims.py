"""経費精算: expense_claims / expense_claim_items ＋ Client.expense_enabled / expense_credit_account_title_id

client-scoped RLS。own = applicant_user_id(一般社員は自分の申請のみ)、all = 管理者/経理/職員。

Revision ID: 0028_expense_claims
Revises: 0027_audit_logs
"""

import sqlalchemy as sa
from alembic import op

revision = "0028_expense_claims"
down_revision = "0027_audit_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())

    cols = {c["name"] for c in insp.get_columns("clients")}
    if "expense_enabled" not in cols:
        op.add_column("clients", sa.Column("expense_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    if "expense_credit_account_title_id" not in cols:
        op.add_column(
            "clients",
            sa.Column("expense_credit_account_title_id", sa.Uuid(), sa.ForeignKey("account_titles.id"), nullable=True),
        )

    if not insp.has_table("expense_claims"):
        op.create_table(
            "expense_claims",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("firm_id", sa.Uuid(), sa.ForeignKey("firms.id", ondelete="CASCADE"), index=True),
            sa.Column("client_id", sa.Uuid(), sa.ForeignKey("clients.id", ondelete="CASCADE"), index=True),
            sa.Column("applicant_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("title", sa.String(length=300), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("approver_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reject_reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if not insp.has_table("expense_claim_items"):
        op.create_table(
            "expense_claim_items",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("claim_id", sa.Uuid(), sa.ForeignKey("expense_claims.id", ondelete="CASCADE"), index=True),
            sa.Column("receipt_id", sa.Uuid(), sa.ForeignKey("receipts.id", ondelete="CASCADE"), index=True),
            sa.Column("client_id", sa.Uuid(), sa.ForeignKey("clients.id", ondelete="CASCADE"), index=True),
            sa.Column("applicant_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
            sa.UniqueConstraint("claim_id", "receipt_id", name="uq_expense_item_claim_receipt"),
        )

    # client-scoped RLS(own=applicant_user_id, all=管理者/経理/職員)。receipts と同じ app_client_access ベース。
    for tbl in ("expense_claims", "expense_claim_items"):
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {tbl} TO receipt_app")
        op.execute(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {tbl} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS tenant_rbac ON {tbl}")
        op.execute(
            f"CREATE POLICY tenant_rbac ON {tbl} FOR ALL "
            f"USING (app_client_access({tbl}.client_id) = 'all' "
            f"  OR (app_client_access({tbl}.client_id) = 'own' AND {tbl}.applicant_user_id = app_uid())) "
            f"WITH CHECK (app_client_access({tbl}.client_id) = 'all' "
            f"  OR (app_client_access({tbl}.client_id) = 'own' AND {tbl}.applicant_user_id = app_uid()))"
        )


def downgrade() -> None:
    for tbl in ("expense_claim_items", "expense_claims"):
        op.execute(f"DROP POLICY IF EXISTS tenant_rbac ON {tbl}")
        op.execute(f"DROP TABLE IF EXISTS {tbl}")
    op.drop_column("clients", "expense_credit_account_title_id")
    op.drop_column("clients", "expense_enabled")
