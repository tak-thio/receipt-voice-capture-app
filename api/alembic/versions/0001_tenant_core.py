"""tenant core schema + RLS policies

Revision ID: 0001_tenant_core
Revises:
Create Date: 2026-06-05
"""

from alembic import op

from app.db import Base
import app.models  # noqa: F401

revision = "0001_tenant_core"
down_revision = None
branch_labels = None
depends_on = None


# Tables to protect with RLS and the predicate shape each needs.
# group "fc"  : table has firm_id + client_id (non-null)
# group "tmpl": table has firm_id + nullable client_id (firm template + override)
# group "c"   : table has client_id only (join clients for firm_id)
RLS_GROUPS = {
    "fc": ["receipts", "files", "partners"],
    "tmpl": ["account_titles", "sub_accounts"],
    "c": ["partner_aliases", "journal_rules"],
}


def _predicate(table: str, group: str) -> str:
    if group == "fc":
        return (
            f"EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = app_uid() "
            f"AND m.firm_id = {table}.firm_id "
            f"AND (m.client_id IS NULL OR m.client_id = {table}.client_id))"
        )
    if group == "tmpl":
        return (
            f"EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = app_uid() "
            f"AND m.firm_id = {table}.firm_id "
            f"AND ({table}.client_id IS NULL OR m.client_id IS NULL "
            f"OR m.client_id = {table}.client_id))"
        )
    # group "c"
    return (
        f"EXISTS (SELECT 1 FROM memberships m JOIN clients c ON c.id = {table}.client_id "
        f"WHERE m.user_id = app_uid() AND m.firm_id = c.firm_id "
        f"AND (m.client_id IS NULL OR m.client_id = {table}.client_id))"
    )


def _apply_rls(table: str, predicate: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY tenant_isolation ON {table} FOR ALL "
        f"USING ({predicate}) WITH CHECK ({predicate})"
    )


def upgrade() -> None:
    bind = op.get_bind()
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # Create all tables from the ORM metadata (initial schema).
    Base.metadata.create_all(bind=bind)

    # Full-text search column on receipts (pg_trgm GIN), mirroring receipt-app.
    op.execute(
        "ALTER TABLE receipts ADD COLUMN search_text text GENERATED ALWAYS AS ("
        "coalesce(vendor,'') || ' ' || coalesce(t_number,'') || ' ' || "
        "coalesce(stt_raw,'') || ' ' || coalesce(ocr_raw,'')) STORED"
    )
    op.execute(
        "CREATE INDEX ix_receipts_search_trgm ON receipts "
        "USING gin (search_text gin_trgm_ops)"
    )

    # Helper: current user id from the transaction-local setting.
    op.execute(
        "CREATE FUNCTION app_uid() RETURNS uuid AS $$ "
        "SELECT nullif(current_setting('app.current_user_id', true), '')::uuid "
        "$$ LANGUAGE sql STABLE"
    )

    # Per-group tenant isolation policies.
    for group, tables in RLS_GROUPS.items():
        for table in tables:
            _apply_rls(table, _predicate(table, group))

    # clients: a member of the firm sees firm-wide (m.client_id NULL) or own client.
    _apply_rls(
        "clients",
        "EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = app_uid() "
        "AND m.firm_id = clients.firm_id "
        "AND (m.client_id IS NULL OR m.client_id = clients.id))",
    )

    # jobs: firm_id + nullable client_id.
    _apply_rls(
        "jobs",
        "EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = app_uid() "
        "AND m.firm_id = jobs.firm_id "
        "AND (jobs.client_id IS NULL OR m.client_id IS NULL "
        "OR m.client_id = jobs.client_id))",
    )

    # receipt_files: inherit access from the parent receipt.
    _apply_rls(
        "receipt_files",
        "EXISTS (SELECT 1 FROM receipts r JOIN memberships m ON m.firm_id = r.firm_id "
        "WHERE r.id = receipt_files.receipt_id AND m.user_id = app_uid() "
        "AND (m.client_id IS NULL OR m.client_id = r.client_id))",
    )

    # NOTE: identity/auth tables (firms, users, memberships, pairing_tokens,
    # device_sessions) are accessed by the auth layer and filtered in
    # application code; DB-level RLS for them is a Phase-1 hardening follow-up.


def downgrade() -> None:
    # Scaffold: drop everything.
    op.execute("DROP FUNCTION IF EXISTS app_uid()")
    Base.metadata.drop_all(bind=op.get_bind())
