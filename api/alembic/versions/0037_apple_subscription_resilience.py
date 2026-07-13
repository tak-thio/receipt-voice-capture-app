"""Apple subscription の account binding・通知 inbox・順序制御用 metadata を追加。

Revision ID: 0037_apple_subscriptions
Revises: 0036_card_batch_id
"""

import sqlalchemy as sa
from alembic import op

revision = "0037_apple_subscriptions"
down_revision = "0036_card_batch_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    firm_columns = {column["name"] for column in insp.get_columns("firms")}
    if "billing_account_token" not in firm_columns:
        op.add_column("firms", sa.Column("billing_account_token", sa.Uuid(), nullable=True))
        op.create_index(
            "uq_firms_billing_account_token",
            "firms",
            ["billing_account_token"],
            unique=True,
        )

    subscription_columns = {
        column["name"] for column in insp.get_columns("subscriptions")
    }
    additions = (
        sa.Column("latest_transaction_id", sa.String(length=100), nullable=True),
        sa.Column("store_environment", sa.String(length=30), nullable=True),
        sa.Column("app_account_token", sa.Uuid(), nullable=True),
        sa.Column("auto_renew_enabled", sa.Boolean(), nullable=True),
        sa.Column("latest_store_signed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    for column in additions:
        if column.name not in subscription_columns:
            op.add_column("subscriptions", column)
    if "app_account_token" not in subscription_columns:
        op.create_index(
            "ix_subscriptions_app_account_token",
            "subscriptions",
            ["app_account_token"],
        )

    if not insp.has_table("store_notification_events"):
        op.create_table(
            "store_notification_events",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("platform", sa.String(length=20), nullable=False, server_default="apple"),
            sa.Column("environment", sa.String(length=30), nullable=True),
            sa.Column("notification_uuid", sa.String(length=100), nullable=False),
            sa.Column("purchase_token", sa.Text(), nullable=True),
            sa.Column("signed_payload", sa.Text(), nullable=False),
            sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="received"),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column(
                "subscription_id",
                sa.Uuid(),
                sa.ForeignKey("subscriptions.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("notification_uuid", name="uq_store_notification_uuid"),
        )
        op.create_index(
            "ix_store_notification_events_purchase_token",
            "store_notification_events",
            ["purchase_token"],
        )
        op.create_index(
            "ix_store_notification_events_status",
            "store_notification_events",
            ["status"],
        )
        op.create_index(
            "ix_store_notification_events_subscription_id",
            "store_notification_events",
            ["subscription_id"],
        )
        op.execute("REVOKE ALL ON store_notification_events FROM receipt_app")


def downgrade() -> None:
    op.drop_table("store_notification_events")
    op.drop_index("ix_subscriptions_app_account_token", table_name="subscriptions")
    for name in (
        "revoked_at",
        "last_verified_at",
        "latest_store_signed_at",
        "auto_renew_enabled",
        "app_account_token",
        "store_environment",
        "latest_transaction_id",
    ):
        op.drop_column("subscriptions", name)
    op.drop_index("uq_firms_billing_account_token", table_name="firms")
    op.drop_column("firms", "billing_account_token")
