"""journal_rules.vendor_key for direct vendor -> account learning

Mobile receipts have no email From/subject, so rules are keyed on the
normalized vendor string instead.

Revision ID: 0004_journal_rule_vendor
Revises: 0003_identity_rls
"""

import sqlalchemy as sa
from alembic import op

revision = "0004_journal_rule_vendor"
down_revision = "0003_identity_rls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: 0001 uses Base.metadata.create_all (current models), so on a
    # FRESH db this column/index may already exist. Skip if present.
    insp = sa.inspect(op.get_bind())
    if "vendor_key" not in {c["name"] for c in insp.get_columns("journal_rules")}:
        op.add_column("journal_rules", sa.Column("vendor_key", sa.String(300), nullable=True))
    if "ix_journal_rules_vendor_key" not in {i["name"] for i in insp.get_indexes("journal_rules")}:
        op.create_index("ix_journal_rules_vendor_key", "journal_rules", ["client_id", "vendor_key"])


def downgrade() -> None:
    op.drop_index("ix_journal_rules_vendor_key", table_name="journal_rules")
    op.drop_column("journal_rules", "vendor_key")
