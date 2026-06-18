"""clients.closing_date(締め日) を追加。

この日付以前(同日含む)の取引日の領収書を、受信箱/仕分けで「期間外」警告にするための
顧問先ごとのロック日。NULL ならチェックなし。

Revision ID: 0026_client_closing_date
Revises: 0025_receipt_memo
"""

import sqlalchemy as sa
from alembic import op

revision = "0026_client_closing_date"
down_revision = "0025_receipt_memo"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    cols = {c["name"] for c in insp.get_columns("clients")}
    if "closing_date" not in cols:
        op.add_column("clients", sa.Column("closing_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("clients", "closing_date")
