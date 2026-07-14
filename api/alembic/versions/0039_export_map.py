"""勘定科目の変換辞書 (他会計システムへのエクスポート用)。

account_titles.export_map (JSONB): 形式ごとの出力名/コード
  {"yayoi": {"name": "交際費"}, "mas": {"code": "8351"}}
- 事務所テンプレ行(client_id=NULL)の map = 事務所の標準辞書
- 顧問先行(コピー)の map = その会社の手動変更
- 解決順: 顧問先 > テンプレ(override_of先) > 自社の科目名(素通し)
顧問先ごとの会計システム選択は既存の clients.export_default を使う。

Revision ID: 0039_export_map
Revises: 0038_currency_tax_lines
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0039_export_map"
down_revision = "0038_currency_tax_lines"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    cols = [c["name"] for c in insp.get_columns("account_titles")]
    if "export_map" not in cols:
        op.add_column("account_titles", sa.Column("export_map", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("account_titles", "export_map")
