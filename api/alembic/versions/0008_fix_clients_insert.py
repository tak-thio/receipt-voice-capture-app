"""fix clients INSERT under RLS

0007's clients policy used the same predicate for USING and WITH CHECK:
    app_client_access(clients.id) <> 'none'
app_client_access() resolves a client's firm by joining the clients table, but
on INSERT the brand-new client row is not visible to a STABLE SECURITY DEFINER
function's snapshot, so app_client_access(NEW.id) returns 'none' and every
client INSERT is rejected (and a client_admin renaming their own client hit the
same path on UPDATE's WITH CHECK).

Fix: keep USING (correctly gates reads/updates to owned/assigned clients) but
make WITH CHECK depend only on the new row's firm_id — no self-join needed:
    clients.firm_id IN (SELECT app_firm_ids())
This mirrors the firm-scoped WITH CHECK already used for template tables/jobs.
The /clients POST endpoint still restricts creation to firm roles.

Revision ID: 0008_fix_clients_insert
Revises: 0007_rbac_assignments
"""

from alembic import op

revision = "0008_fix_clients_insert"
down_revision = "0007_rbac_assignments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_rbac ON clients")
    op.execute(
        "CREATE POLICY tenant_rbac ON clients FOR ALL "
        "USING (app_client_access(clients.id) <> 'none') "
        "WITH CHECK (clients.firm_id IN (SELECT app_firm_ids()))"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_rbac ON clients")
    op.execute(
        "CREATE POLICY tenant_rbac ON clients FOR ALL "
        "USING (app_client_access(clients.id) <> 'none') "
        "WITH CHECK (app_client_access(clients.id) <> 'none')"
    )
