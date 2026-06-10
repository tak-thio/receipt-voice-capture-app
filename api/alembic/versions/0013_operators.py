"""operators table (platform 運営: provision & manage 税理士事務所)

A global (non-tenant) identity table for platform operators. Like
pairing_tokens / device_sessions it is intentionally left un-RLS'd: it is only
ever read/written by operator-authenticated endpoints, and operators must not be
tenant-scoped (an operator has no membership, so existing RLS already keeps them
out of every tenant's receipt/client data).

Revision ID: 0013_operators
Revises: 0012_capture_meta
"""

import sqlalchemy as sa
from alembic import op

revision = "0013_operators"
down_revision = "0012_capture_meta"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a FRESH db 0001's create_all already made this table from
    # the ORM metadata (Operator model), and 0002's default privileges granted
    # receipt_app DML. Skip the create in that case (mirrors 0005_invites).
    if sa.inspect(op.get_bind()).has_table("operators"):
        return
    op.create_table(
        "operators",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("name", sa.String(200), nullable=False, server_default=""),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_operators_email", "operators", ["email"], unique=True)
    # Default privileges from 0002 cover future tables, but be explicit.
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON operators TO receipt_app")


def downgrade() -> None:
    op.execute("REVOKE ALL ON operators FROM receipt_app")
    op.drop_index("ix_operators_email", table_name="operators")
    op.drop_table("operators")
