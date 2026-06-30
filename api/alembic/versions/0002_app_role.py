"""restricted runtime role (RLS-bound)

The app must NOT connect as the owner/superuser, because superusers bypass RLS
entirely (even with FORCE ROW LEVEL SECURITY). This creates a least-privilege
role `receipt_app` (NOSUPERUSER, NOBYPASSRLS) for the running app, with DML
grants. Migrations keep running as the owner.

Revision ID: 0002_app_role
Revises: 0001_tenant_core
"""

from alembic import op

revision = "0002_app_role"
down_revision = "0001_tenant_core"
branch_labels = None
depends_on = None

APP_ROLE = "receipt_app"
APP_PASSWORD = "receipt_app"  # scaffold default; override in production


def upgrade() -> None:
    op.execute(
        f"""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
            CREATE ROLE {APP_ROLE} LOGIN PASSWORD '{APP_PASSWORD}'
              NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
          END IF;
        END $$;
        """
    )
    op.execute(f"GRANT USAGE ON SCHEMA public TO {APP_ROLE}")
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {APP_ROLE}"
    )
    op.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {APP_ROLE}")
    op.execute(f"GRANT EXECUTE ON FUNCTION app_uid() TO {APP_ROLE}")
    # Future tables created by the owner are usable by the app role too.
    op.execute(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {APP_ROLE}"
    )
    op.execute(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        f"GRANT USAGE, SELECT ON SEQUENCES TO {APP_ROLE}"
    )


def downgrade() -> None:
    op.execute(f"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {APP_ROLE}")
    op.execute(f"REVOKE ALL ON SCHEMA public FROM {APP_ROLE}")
    op.execute(f"DROP ROLE IF EXISTS {APP_ROLE}")
