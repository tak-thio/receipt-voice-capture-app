"""外貨対応＋消費税の行リスト化。

- currency/foreign_amount/exchange_rate: 明細書・領収書に印字された通貨・現地ご利用額・
  換算レートをそのまま保持(円建てはNULL)。外貨取引の照合キーは (currency, foreign_amount)
  — 円は発行者/カード会社でレートが違い一致しないため(例: OpenAI $220 = 領収書側¥表記なし
  / カード側¥36,409)。
- tax_lines: 消費税内訳の配列 [{"label":"10%","tax_jpy":3184,"base_jpy":31840}]。
  label は書面の表記そのまま(10%/8%/その他/非課税/対象外/将来の新税率)。税率マスタは持たず
  計算もしない=請求書通りに保存。固定の tax_10_jpy/tax_8_jpy を置換(旧列はDBに残置し、
  本マイグレーションで tax_lines へ変換。モデルからは撤去)。

Revision ID: 0038_currency_tax_lines
Revises: 0037_apple_subscriptions
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0038_currency_tax_lines"
down_revision = "0037_apple_subscriptions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    cols = [c["name"] for c in insp.get_columns("receipts")]
    if "currency" not in cols:
        op.add_column("receipts", sa.Column("currency", sa.String(8), nullable=True))
    if "foreign_amount" not in cols:
        op.add_column("receipts", sa.Column("foreign_amount", sa.Numeric(14, 2), nullable=True))
    if "exchange_rate" not in cols:
        op.add_column("receipts", sa.Column("exchange_rate", sa.Numeric(12, 6), nullable=True))
    if "tax_lines" not in cols:
        op.add_column("receipts", sa.Column("tax_lines", JSONB(), nullable=True))
        # 既存の 10%/8% 固定列を行リストへ変換(値はそのまま。以後は tax_lines が正)。
        op.execute(
            "UPDATE receipts SET tax_lines = '[]'::jsonb "
            "WHERE tax_10_jpy IS NOT NULL OR tax_8_jpy IS NOT NULL"
        )
        op.execute(
            "UPDATE receipts SET tax_lines = tax_lines || "
            "jsonb_build_array(jsonb_build_object('label','10%','tax_jpy',tax_10_jpy)) "
            "WHERE tax_10_jpy IS NOT NULL"
        )
        op.execute(
            "UPDATE receipts SET tax_lines = tax_lines || "
            "jsonb_build_array(jsonb_build_object('label','8%','tax_jpy',tax_8_jpy)) "
            "WHERE tax_8_jpy IS NOT NULL"
        )


def downgrade() -> None:
    op.drop_column("receipts", "tax_lines")
    op.drop_column("receipts", "exchange_rate")
    op.drop_column("receipts", "foreign_amount")
    op.drop_column("receipts", "currency")
