"""自動重複(突き合わせ)の再計算。

同じ取引を1つにまとめる。判定キー:
- 同日(利用日/領収書日付) ＋ 同金額(税込)。
- 領収書同士は さらに 取引先(正規化)が一致したときだけ同一とみなす。
- カード明細行(card_statement)が絡むものは 日付＋金額のみで同一とみなす
  (カードの利用先名は領収書の取引先と表記が違うため取引先は条件にしない)。

各グループの親(残す1件)は「領収書優先 → 仕訳済 → T番号あり → 登録が早い」。
親は pending、それ以外は自動で duplicate(=仕訳/元帳から除外)。
利用者が「重複ではない」とした行(capture_meta.dedup_split=true)はグループから外す。

明示的な引き当て操作はなく、取込時と画面表示時に毎回これを呼んで自動適用する。
"""

from collections import defaultdict
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .journaling import normalize_vendor
from .models import Receipt

CARD = "card_statement"
# dedup が管理する承認状態(これ以外: rejected/mistake/deleted は触らない)。
_MANAGED = ["pending", "duplicate"]


def _date_key(r: Receipt):
    return r.captured_at.date().isoformat() if r.captured_at else None


def _partner_key(r: Receipt) -> str:
    """領収書の取引先キー(取引先名 > 店舗名 を正規化)。"""
    return normalize_vendor(r.partner_name or r.vendor)


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
        if _is_split(r) or r.amount_jpy is None or not _date_key(r):
            continue
        buckets[(r.amount_jpy, _date_key(r))].append(r)

    for members in buckets.values():
        if len(members) < 2:
            continue
        if any(m.doc_type == CARD for m in members):
            # カードが絡む → 日付+金額だけで全部同一
            for m in members[1:]:
                union(members[0].id, m.id)
        else:
            # 領収書のみ → 取引先が一致するものだけ同一
            by_partner: dict = defaultdict(list)
            for m in members:
                by_partner[_partner_key(m)].append(m)
            for grp in by_partner.values():
                for m in grp[1:]:
                    union(grp[0].id, m.id)

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
