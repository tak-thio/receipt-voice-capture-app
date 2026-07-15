"""自動重複(突き合わせ)の再計算。

同じ取引を1つにまとめる。判定キー = **同日(利用日/領収書日付) ＋ 同金額(税込)** のみ。
外貨で円が未確定の領収書は 金額の代わりに (通貨, 現地額) を使う。

取引先の一致は条件にしない(2026-07-15にuser判断で撤廃): 取引先はAI読取で表記が
ゆらぐ(同じ店でも経路により「スターバックス」「STARBUCKS」等)ため、条件に入れると
本物の重複が静かにすり抜ける。過検知は受信箱/重複チェックで目立ち「重複ではない」
1クリック(永続)で外せるが、見逃しは誰も気づけない=二重計上になる。この非対称性から
「ゆるく検知して人が外す」に倒す。

各グループの親(残す1件)は「領収書優先 → 仕訳済 → T番号あり → 登録が早い」。
親は pending、それ以外は自動で duplicate(=仕訳/元帳から除外)。
利用者が「重複ではない」とした行(capture_meta.dedup_split=true)はグループから外す。

明示的な引き当て操作はなく、取込時と画面表示時に毎回これを呼んで自動適用する。
"""

from collections import defaultdict
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Receipt, ReceiptLane

CARD = "card_statement"
# dedup が管理する承認状態(これ以外: rejected/mistake/deleted は触らない)。
_MANAGED = ["pending", "duplicate"]


def _date_key(r: Receipt):
    return r.captured_at.date().isoformat() if r.captured_at else None


def _is_split(r: Receipt) -> bool:
    return bool((r.capture_meta or {}).get("dedup_split"))


def _primary_sort_key(r: Receipt):
    # 小さいほど親に近い: 領収書優先 → 仕訳済 → T番号あり → 登録が早い。
    return (
        0 if r.doc_type == "receipt" else 1,
        0 if r.journalized_at else 1,
        0 if (r.t_number or "").strip() else 1,
        r.created_at,
    )


def _components(rows: list[Receipt]) -> list[list[Receipt]]:
    """Union-Find で同一取引のグループ(連結成分)を作る。split された行は単独。"""
    parent: dict = {}

    def find(x):
        parent.setdefault(x, x)
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    def union(a, b):
        parent[find(a)] = find(b)

    buckets: dict = defaultdict(list)
    for r in rows:
        if _is_split(r) or not _date_key(r):
            continue
        if r.amount_jpy is not None:
            key = (r.amount_jpy, _date_key(r))
        elif r.currency and r.foreign_amount is not None:
            # 外貨領収書(円総額なし)は現地額で突き合わせ(同じUSD領収書の二重アップ検知)。
            key = (("fx", r.currency, str(r.foreign_amount)), _date_key(r))
        else:
            continue
        buckets[key].append(r)

    for members in buckets.values():
        if len(members) < 2:
            continue
        # 同日+同額なら取引先を問わず同一候補(AI読取の表記ゆらぎで見逃さないため)。
        # 別取引の同日同額は「重複ではない」で人が外す(永続)。
        for m in members[1:]:
            union(members[0].id, m.id)

    by_id = {r.id: r for r in rows}
    comps: dict = defaultdict(list)
    for r in rows:
        root = find(r.id) if (r.id in parent) else r.id
        comps[root].append(r)
    return list(comps.values())


async def recompute_dedup(session: AsyncSession, client_id: UUID) -> None:
    """顧問先のレコードを再スキャンし、自動的に親=pending / 重複=duplicate に整える。"""
    rows = list(
        await session.scalars(
            select(Receipt).where(
                Receipt.client_id == client_id,
                # マージで束ねた元(統合伝票に紐付いた明細/鏡)は突き合わせ対象外。
                Receipt.merged_into.is_(None),
                # 立替(expense)は対象外。会社経費(company)のみ。
                Receipt.lane == ReceiptLane.company.value,
                # クレジット明細は「クレジット明細」画面で領収書と照合するため、突き合わせ(重複検知)の対象外。
                Receipt.doc_type != CARD,
                Receipt.approval_status.in_(_MANAGED),
            )
        )
    )
    for members in _components(rows):
        if len(members) == 1:
            m = members[0]
            if m.approval_status == "duplicate":
                m.approval_status = "pending"  # 単独になった重複は復活
            m.match_id = None
            continue
        members.sort(key=_primary_sort_key)
        primary = members[0]
        mid = next((m.match_id for m in members if m.match_id), None) or uuid4()
        for m in members:
            m.match_id = mid
            if m is primary:
                if m.approval_status == "duplicate":
                    m.approval_status = "pending"
            else:
                m.approval_status = "duplicate"
    await session.flush()
