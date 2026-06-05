"""extended master fields on clients and users

Revision ID: 0006_master_fields
Revises: 0005_invites
"""

import sqlalchemy as sa
from alembic import op

revision = "0006_master_fields"
down_revision = "0005_invites"
branch_labels = None
depends_on = None

CLIENT_COLUMNS = [
    ("entity_type", sa.String(20)),
    ("t_number", sa.String(20)),
    ("address", sa.String(300)),
    ("phone", sa.String(50)),
    ("contact_name", sa.String(100)),
    ("fiscal_month", sa.Integer()),
    ("industry", sa.String(100)),
    ("memo", sa.Text()),
]


def upgrade() -> None:
    for name, type_ in CLIENT_COLUMNS:
        op.add_column("clients", sa.Column(name, type_, nullable=True))
    op.add_column(
        "clients",
        sa.Column("staff_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.add_column("users", sa.Column("phone", sa.String(50), nullable=True))
    op.add_column(
        "users", sa.Column("status", sa.String(20), nullable=False, server_default="active")
    )


def downgrade() -> None:
    op.drop_column("users", "status")
    op.drop_column("users", "phone")
    op.drop_column("clients", "staff_user_id")
    for name, _ in reversed(CLIENT_COLUMNS):
        op.drop_column("clients", name)
