"""role-aware access: staff↔client assignments + own-data scope

Adds staff_clients (firm_staff n:n 顧問先) and rebuilds the data-table RLS so:
- firm_owner (管理者/職員): all clients
- firm_staff (一般社員/職員): assigned clients only (staff_clients)
- client_admin / client_accountant (管理者/経理担当者): all of their client's data
- client_user (一般社員/利用者): only rows they created (created_by/uploaded_by)

Access is decided by a SECURITY DEFINER helper app_client_access(client) ->
'all' | 'own' | 'none' (bypasses RLS to read memberships/staff_clients, so no
policy recursion).

Revision ID: 0007_rbac_assignments
Revises: 0006_master_fields
"""

import sqlalchemy as sa
from alembic import op

revision = "0007_rbac_assignments"
down_revision = "0006_master_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "staff_clients",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("firm_id", sa.Uuid(), sa.ForeignKey("firms.id", ondelete="CASCADE"), index=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), index=True),
        sa.Column("client_id", sa.Uuid(), sa.ForeignKey("clients.id", ondelete="CASCADE"), index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "client_id"),
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON staff_clients TO receipt_app")

    # Access level the current user has for a client: 'all' | 'own' | 'none'.
    op.execute(
        """
        CREATE FUNCTION app_client_access(p_client uuid) RETURNS text
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
          SELECT CASE
            WHEN p_client IS NULL THEN 'none'
            WHEN EXISTS (
              SELECT 1 FROM memberships m JOIN clients c ON c.id = p_client
              WHERE m.user_id = app_uid() AND m.firm_id = c.firm_id
                AND m.client_id IS NULL AND m.role = 'firm_owner') THEN 'all'
            WHEN EXISTS (
              SELECT 1 FROM memberships m JOIN clients c ON c.id = p_client
              WHERE m.user_id = app_uid() AND m.firm_id = c.firm_id
                AND m.client_id IS NULL AND m.role = 'firm_staff'
                AND EXISTS (SELECT 1 FROM staff_clients sc
                            WHERE sc.user_id = app_uid() AND sc.client_id = p_client)) THEN 'all'
            WHEN EXISTS (
              SELECT 1 FROM memberships m WHERE m.user_id = app_uid() AND m.client_id = p_client
                AND m.role IN ('client_admin','client_accountant')) THEN 'all'
            WHEN EXISTS (
              SELECT 1 FROM memberships m WHERE m.user_id = app_uid() AND m.client_id = p_client
                AND m.role = 'client_user') THEN 'own'
            ELSE 'none'
          END
        $$
        """
    )
    op.execute("GRANT EXECUTE ON FUNCTION app_client_access(uuid) TO receipt_app")

    # Rebuild policies (drop the flat tenant_isolation from 0001).
    own_tables = {
        "receipts": "created_by",
        "files": "uploaded_by",
    }
    client_scoped = ["partners", "partner_aliases", "journal_rules"]
    template_tables = ["account_titles", "sub_accounts"]

    for table, owner_col in own_tables.items():
        pred = (
            f"app_client_access({table}.client_id) = 'all' "
            f"OR (app_client_access({table}.client_id) = 'own' "
            f"AND {table}.{owner_col} = app_uid())"
        )
        _policy(table, pred)

    for table in client_scoped:
        _policy(table, f"app_client_access({table}.client_id) <> 'none'")

    for table in template_tables:
        _policy(
            table,
            f"({table}.client_id IS NULL AND {table}.firm_id IN (SELECT app_firm_ids())) "
            f"OR ({table}.client_id IS NOT NULL AND app_client_access({table}.client_id) <> 'none')",
        )

    _policy("clients", "app_client_access(clients.id) <> 'none'")
    _policy(
        "jobs",
        "(jobs.client_id IS NULL AND jobs.firm_id IN (SELECT app_firm_ids())) "
        "OR app_client_access(jobs.client_id) <> 'none'",
    )
    _policy(
        "receipt_files",
        "EXISTS (SELECT 1 FROM receipts r WHERE r.id = receipt_files.receipt_id "
        "AND (app_client_access(r.client_id) = 'all' "
        "OR (app_client_access(r.client_id) = 'own' AND r.created_by = app_uid())))",
    )


def _policy(table: str, predicate: str) -> None:
    op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
    op.execute(
        f"CREATE POLICY tenant_rbac ON {table} FOR ALL "
        f"USING ({predicate}) WITH CHECK ({predicate})"
    )


def downgrade() -> None:
    tables = [
        "receipts", "files", "partners", "partner_aliases", "journal_rules",
        "account_titles", "sub_accounts", "clients", "jobs", "receipt_files",
    ]
    for table in tables:
        op.execute(f"DROP POLICY IF EXISTS tenant_rbac ON {table}")
    op.execute("DROP FUNCTION IF EXISTS app_client_access(uuid)")
    op.execute("DROP TABLE IF EXISTS staff_clients")
