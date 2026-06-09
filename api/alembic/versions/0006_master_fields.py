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
    # Idempotent (fresh db: columns may already exist via 0001 create_all).
    insp = sa.inspect(op.get_bind())
    clients_cols = {c["name"] for c in insp.get_columns("clients")}
    users_cols = {c["name"] for c in insp.get_columns("users")}
    for name, type_ in CLIENT_COLUMNS:
        if name not in clients_cols:
            op.add_column("clients", sa.Column(name, type_, nullable=True))
    if "staff_user_id" not in clients_cols:
        op.add_column(
            "clients",
            sa.Column("staff_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        )
    if "phone" not in users_cols:
        op.add_column("users", sa.Column("phone", sa.String(50), nullable=True))
    if "status" not in users_cols:
        op.add_column(
            "users", sa.Column("status", sa.String(20), nullable=False, server_default="active")
        )


def downgrade() -> None:
    op.drop_column("users", "status")
    op.drop_column("users", "phone")
    op.drop_column("clients", "staff_user_id")
    for name, _ in reversed(CLIENT_COLUMNS):
        op.drop_column("clients", name)
