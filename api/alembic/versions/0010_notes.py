"""付箋 (notes): per-client text+colour labels, attachable to receipts

- notes: client-scoped master (RLS like partners).
- receipts.note_ids: JSONB array of note ids attached to a receipt.

Revision ID: 0010_notes
Revises: 0009_user_job_title
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0010_notes"
down_revision = "0009_user_job_title"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("firm_id", sa.Uuid(), sa.ForeignKey("firms.id", ondelete="CASCADE"), index=True),
        sa.Column("client_id", sa.Uuid(), sa.ForeignKey("clients.id", ondelete="CASCADE"), index=True),
        sa.Column("text", sa.String(length=100), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=False, server_default="amber"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON notes TO receipt_app")

    # Client-scoped RLS (mirrors partners under the 0007 rebuild).
    op.execute("ALTER TABLE notes ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE notes FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_rbac ON notes FOR ALL "
        "USING (app_client_access(notes.client_id) <> 'none') "
        "WITH CHECK (app_client_access(notes.client_id) <> 'none')"
    )

    # Attached note ids on each receipt (resolved to text/colour client-side).
    op.add_column(
        "receipts",
        sa.Column(
            "note_ids",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("receipts", "note_ids")
    op.execute("DROP POLICY IF EXISTS tenant_rbac ON notes")
    op.execute("DROP TABLE IF EXISTS notes")
