"""receipts: 既存の『未解析』滞留行に parse_failed 印をバックフィル。

これまで AI が請求書として認識できなかった行も、アップロード直後の処理待ちと同じ
vendor='未解析' のまま受信箱に出ていた。ワーカーは今後 capture_meta.parse_failed を
立てて区別するが、既に滞留している行には印が無いので、ここで一括付与する。

vendor='未解析' は (a) batch の抽出ゼロ画像 (b) web アップロードの失敗/処理待ち。
処理待ちの稀な行に誤って印が付いても、ワーカー完了時に _mark_parse_outcome が認識成功
なら印を消すため自己修復する。

Revision ID: 0024_receipt_parse_failed
Revises: 0023_receipt_partner_name
"""

from alembic import op

revision = "0024_receipt_parse_failed"
down_revision = "0023_receipt_partner_name"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE receipts
        SET capture_meta = jsonb_set(
            coalesce(capture_meta, '{}'::jsonb), '{parse_failed}', 'true'::jsonb, true
        )
        WHERE vendor = '未解析'
          AND coalesce(capture_meta->>'parse_failed', '') <> 'true'
        """
    )


def downgrade() -> None:
    op.execute("UPDATE receipts SET capture_meta = capture_meta - 'parse_failed'")
