"""RLS for identity tables (firms / users / memberships)

Restrict cross-tenant READS of identity data (defense in depth on top of the
app's own filtering). Writes stay permissive and an `app_uid() IS NULL` escape
keeps the pre-auth flows working (login looks up a user by email, register and
pairing insert rows, all before an RLS context is bound). Recursion on the
memberships policy is avoided with a SECURITY DEFINER helper that reads
memberships bypassing RLS.

pairing_tokens / device_sessions are intentionally left un-RLS'd: they are
looked up by opaque token during unauthenticated redeem / device auth.

Revision ID: 0003_identity_rls
Revises: 0002_app_role
"""

from alembic import op

revision = "0003_identity_rls"
down_revision = "0002_app_role"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SECURITY DEFINER: runs as the (superuser) owner and so bypasses RLS on
    # memberships, breaking the recursion that a memberships policy would cause.
    op.execute(
        "CREATE FUNCTION app_firm_ids() RETURNS setof uuid "
        "LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ "
        "SELECT firm_id FROM memberships WHERE user_id = app_uid() $$"
    )
    op.execute("GRANT EXECUTE ON FUNCTION app_firm_ids() TO receipt_app")

    selects = {
        "firms": "id IN (SELECT app_firm_ids())",
        "memberships": "firm_id IN (SELECT app_firm_ids())",
        "users": (
            "id = app_uid() OR id IN ("
            "SELECT user_id FROM memberships WHERE firm_id IN (SELECT app_firm_ids()))"
        ),
    }
    for table, tenant in selects.items():
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        # Reads are tenant-restricted; the NULL escape keeps pre-auth lookups working.
        op.execute(
            f"CREATE POLICY tenant_read ON {table} FOR SELECT "
            f"USING (app_uid() IS NULL OR {tenant})"
        )
        # Writes stay permissive (no endpoint mutates identity rows by arbitrary id;
        # the app controls inserts during register / pairing).
        op.execute(f"CREATE POLICY allow_insert ON {table} FOR INSERT WITH CHECK (true)")
        op.execute(f"CREATE POLICY allow_update ON {table} FOR UPDATE USING (true) WITH CHECK (true)")
        op.execute(f"CREATE POLICY allow_delete ON {table} FOR DELETE USING (true)")


def downgrade() -> None:
    for table in ("firms", "memberships", "users"):
        for pol in ("tenant_read", "allow_insert", "allow_update", "allow_delete"):
            op.execute(f"DROP POLICY IF EXISTS {pol} ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.execute("DROP FUNCTION IF EXISTS app_firm_ids()")
