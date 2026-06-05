"""add users.job_title (役職: 代表取締役/部長 等)

Distinct from the system role (管理者/経理担当者/一般社員): this is the person's
organizational title at the client company. Free text, nullable.

Revision ID: 0009_user_job_title
Revises: 0008_fix_clients_insert
"""

import sqlalchemy as sa
from alembic import op

revision = "0009_user_job_title"
down_revision = "0008_fix_clients_insert"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("job_title", sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "job_title")
