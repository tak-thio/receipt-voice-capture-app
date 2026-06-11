"""per-client AI provider config (clients.ai_config)

Adds a JSONB ai_config to clients so a 顧問先 can have its own AI provider/keys,
resolved as client > firm in the worker. Keys are Fernet-encrypted; the API only
ever returns a masked view (key_set bool), never the raw key.

Revision ID: 0014_client_ai_config
Revises: 0013_operators
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0014_client_ai_config"
down_revision = "0013_operators"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a FRESH db 0001's create_all already added the column from
    # the ORM model. Only add it where missing (existing deployments).
    cols = [c["name"] for c in sa.inspect(op.get_bind()).get_columns("clients")]
    if "ai_config" not in cols:
        op.add_column(
            "clients",
            sa.Column(
                "ai_config",
                postgresql.JSONB,
                nullable=False,
                server_default=sa.text("'{}'::jsonb"),
            ),
        )


def downgrade() -> None:
    op.drop_column("clients", "ai_config")
