"""invites table (firm staff / client user onboarding via link)

Revision ID: 0005_invites
Revises: 0004_journal_rule_vendor
"""

import sqlalchemy as sa
from alembic import op

revision = "0005_invites"
down_revision = "0004_journal_rule_vendor"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "invites",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("firm_id", sa.Uuid(), sa.ForeignKey("firms.id", ondelete="CASCADE"), index=True),
        sa.Column("client_id", sa.Uuid(), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=True),
        sa.Column("role", sa.String(30), nullable=False),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("token_hash", sa.String(255), index=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    # Grant the restricted runtime role DML on the new table (default privileges
    # from 0002 cover this for future tables, but be explicit).
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON invites TO receipt_app")


def downgrade() -> None:
    op.drop_table("invites")
