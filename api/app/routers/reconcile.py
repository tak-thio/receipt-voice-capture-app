"""突き合わせ (reconciliation): カード利用明細の行と、個人が上げた領収書を
「同じ取引」としてまとめる。

キー = 金額(税込)完全一致 ＋ 利用日 == 領収書の日付(同日)。候補は提示するが、
実際のひも付け(match_id 付与)は人間が確認して確定する。順番に依存せず、
すでに仕分け済みの領収書にも、後から来たカード明細を紐づけられる。
"""

from collections import defaultdict
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import Principal, get_principal
from ..models import File, Receipt, ReceiptFile

router = APIRouter(prefix="/reconcile", tags=["reconcile"])

CARD = "card_statement"
RECEIPT = "receipt"


async def _images(session: AsyncSession, receipt_ids) -> dict:
    """receipt_id -> (file_id, mime, sha256) を1クエリで(キャプチャ画像のみ)。"""
    ids = list(receipt_ids)
    if not ids:
        return {}
    rows = await session.execute(
        select(ReceiptFile.receipt_id, ReceiptFile.file_id, File.mime, File.sha256)
        .join(File, File.id == ReceiptFile.file_id)
        .where(ReceiptFile.receipt_id.in_(ids), ReceiptFile.kind == "capture")
    )
    out: dict = {}
    for rid, fid, mime, sha in rows.all():
        out.setdefault(rid, (fid, mime, sha))
    return out


def _norm_vendor(s: str | None) -> str:
    """店名の正規化(前後空白除去・全角/半角空白除去・小文字化)。あいまい一致はしない。"""
    return (s or "").strip().replace(" ", "").replace("　", "").lower()


def _item(r: Receipt, imgs: dict) -> dict:
    fid, mime, _sha = imgs.get(r.id, (None, None, None))
    return {
        "id": str(r.id),
        "doc_type": r.doc_type,
        "source": r.source,
        "date": r.captured_at.date().isoformat() if r.captured_at else None,
        "vendor": r.vendor,
        "amount_jpy": r.amount_jpy,
        "t_number": r.t_number,
        "payment_method": r.payment_method,
        "journalized_at": r.journalized_at.isoformat() if r.journalized_at else None,
        "match_id": str(r.match_id) if r.match_id else None,
        "image_file_id": str(fid) if fid else None,
        "image_mime": mime,
    }


def _key(r: Receipt):
    """突き合わせキー: (税込金額, 利用日)。どちらか欠けると照合不可。"""
    if r.amount_jpy is None or r.captured_at is None:
        return None
    return (r.amount_jpy, r.captured_at.date().isoformat())


@router.get("")
async def reconcile(
    client_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """突き合わせの状態を返す:
    - groups: 既にひも付け済みのグループ(match_id 単位)
    - pending: 未ひも付けのカード明細行と、その候補領収書(金額一致+同日)
      candidates が空＝領収書なし(本人に催促)。unique=候補1件で一意。
    """
    rows = list(
        await session.scalars(
            select(Receipt).where(
                Receipt.client_id == client_id,
                Receipt.approval_status == "pending",
            )
        )
    )
    imgs = await _images(session, [r.id for r in rows])

    # 候補にできる未マッチ領収書を (金額,利用日) で索引化
    recs_by_key: dict = defaultdict(list)
    for r in rows:
        if r.doc_type == RECEIPT and r.match_id is None:
            k = _key(r)
            if k:
                recs_by_key[k].append(r)

    # ひも付け済みグループ
    groups: dict = defaultdict(list)
    for r in rows:
        if r.match_id:
            groups[str(r.match_id)].append(r)

    # 未ひも付けのカード明細行ごとに候補を出す
    pending = []
    for c in rows:
        if c.doc_type != CARD or c.match_id is not None:
            continue
        k = _key(c)
        cands = recs_by_key.get(k, []) if k else []
        pending.append(
            {
                "card": _item(c, imgs),
                "candidates": [_item(x, imgs) for x in cands],
                "unique": len(cands) == 1,
            }
        )

    # 重複（同じ領収書の二重登録）の検出: 領収書同士で
    #   (税込金額・利用日・正規化店名が一致) または (画像の sha256 が一致)
    # を「同じもの」とみなし、Union-Find で連結成分にまとめる(2件以上を候補に)。
    rid_by = {r.id: r for r in rows if r.doc_type == RECEIPT}
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

    buckets: dict = defaultdict(list)  # (金額,利用日,店名) と sha のどちらも同じバケツキーで集約
    for r in rid_by.values():
        if r.amount_jpy is not None and r.captured_at:
            buckets[("k", r.amount_jpy, r.captured_at.date().isoformat(), _norm_vendor(r.vendor))].append(r.id)
        sha = imgs.get(r.id, (None, None, None))[2]
        if sha:
            buckets[("sha", sha)].append(r.id)
    for ids2 in buckets.values():
        for other in ids2[1:]:
            union(ids2[0], other)

    comps: dict = defaultdict(list)
    for rid in rid_by:
        if rid in parent:
            comps[find(rid)].append(rid)
    duplicates = [
        {"items": [_item(rid_by[i], imgs) for i in members]}
        for members in comps.values()
        if len(members) >= 2
    ]

    return {
        "groups": [
            {"match_id": mid, "items": [_item(x, imgs) for x in members]}
            for mid, members in groups.items()
        ],
        "pending": pending,
        "duplicates": duplicates,
    }


class DuplicateBody(BaseModel):
    receipt_id: UUID  # 重複として除外する(残す方ではない)領収書


@router.post("/duplicate")
async def mark_duplicate(
    body: DuplicateBody,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """指定の領収書を「重複」としてマークする(approval_status='duplicate')。
    pending から外れるので仕分け・元帳・受信箱の対象から消える。残す方は触らない。"""
    r = await session.get(Receipt, body.receipt_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "receipt not found")
    r.approval_status = "duplicate"
    await session.flush()
    return {"id": str(r.id), "approval_status": r.approval_status}


class LinkBody(BaseModel):
    ids: list[UUID]  # まとめる対象(カード明細行 + 領収書 など2件以上)


@router.post("/link")
async def link(
    body: LinkBody,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """人が確認した組を1グループにまとめる(共有 match_id を付与)。"""
    if len(body.ids) < 2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "2件以上を指定してください")
    recs: list[Receipt] = []
    for rid in body.ids:
        r = await session.get(Receipt, rid)
        if not r:  # RLS で見えない/存在しない
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"receipt {rid} not found")
        recs.append(r)
    # 既存グループがあればそれに合流、無ければ新規 match_id。
    existing = next((r.match_id for r in recs if r.match_id), None)
    mid = existing or uuid4()
    for r in recs:
        r.match_id = mid
        # 領収書側に支払方法が無ければ「クレジットカード」を補完(カード行との組なら明白)。
        if r.doc_type == RECEIPT and not r.payment_method and any(x.doc_type == CARD for x in recs):
            r.payment_method = "クレジットカード"
    await session.flush()
    return {"match_id": str(mid)}


class UnlinkBody(BaseModel):
    match_id: UUID | None = None
    receipt_id: UUID | None = None


@router.post("/unlink")
async def unlink(
    body: UnlinkBody,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """グループ全体(match_id)または1件(receipt_id)のひも付けを解除する。"""
    if body.match_id:
        rows = await session.scalars(select(Receipt).where(Receipt.match_id == body.match_id))
        for r in rows:
            r.match_id = None
    elif body.receipt_id:
        r = await session.get(Receipt, body.receipt_id)
        if r:
            r.match_id = None
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "match_id か receipt_id が必要です")
    await session.flush()
    return {"ok": True}
