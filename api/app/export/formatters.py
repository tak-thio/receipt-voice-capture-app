"""CSV formatters ported from the mobile app
(mobile/src/services/export/formatters/*: freee, yayoi, mas, generic).

The mobile version mapped `record.final.*`; here we map the server `Receipt`
(+ resolved account title name) via the RowView below. Column layouts, the
MAS index positions, and tax-mode mappings are kept identical.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Callable, Sequence
from dataclasses import dataclass

TAX_LABELS = {"inclusive": "税込", "exclusive": "税抜", "unknown": "未指定"}


def tax_label(mode: str | None) -> str:
    return TAX_LABELS.get(mode or "unknown", "未指定")


def tax_mas(mode: str | None) -> str:
    # mobile mas-formatter: inclusive -> '1', exclusive -> '0', else ''
    return {"inclusive": "1", "exclusive": "0"}.get(mode or "", "")


@dataclass
class RowView:
    date: str
    vendor: str
    amount: str
    tax_mode: str | None
    account: str
    payment_method: str
    t_number: str
    description: str


def _freee(rows: Sequence[RowView]) -> tuple[list[str], list[list[str]]]:
    headers = ["発生日", "取引先", "金額", "税区分", "勘定科目", "摘要"]
    return headers, [
        [r.date, r.vendor, r.amount, tax_label(r.tax_mode), r.account, r.description]
        for r in rows
    ]


def _yayoi(rows: Sequence[RowView]) -> tuple[list[str], list[list[str]]]:
    headers = ["日付", "支払先", "金額", "税区分", "勘定科目", "メモ"]
    return headers, [
        [r.date, r.vendor, r.amount, tax_label(r.tax_mode), r.account, r.description]
        for r in rows
    ]


def _generic(rows: Sequence[RowView]) -> tuple[list[str], list[list[str]]]:
    headers = [
        "date", "vendor", "tax_mode", "amount", "payment_method",
        "account_category_final", "invoice_number",
    ]
    return headers, [
        [r.date, r.vendor, r.tax_mode or "", r.amount, r.payment_method, r.account, r.t_number]
        for r in rows
    ]


MAS_HEADERS = [
    "伝票日付", "内部月", "伝票ＮＯ", "証憑ＮＯ", "データ種別", "仕訳入力形式",
    "(借方)勘定科目コード", "(借方)科目別補助コード", "(借方)部門コード", "(借方)セグメント１コード",
    "(借方)消費税売上/仕入区分", "(借方)業種コード", "(借方)税込/税抜区分", "(借方)第１補助区分",
    "(借方)第１補助コード", "(借方)第２補助区分", "(借方)第２補助コード",
    "(貸方)勘定科目コード", "(貸方)科目別補助コード", "(貸方)部門コード", "(貸方)セグメント１コード",
    "(貸方)消費税売上/仕入区分", "(貸方)業種コード", "(貸方)税込/税抜区分", "(貸方)第１補助区分",
    "(貸方)第１補助コード", "(貸方)第２補助区分", "(貸方)第２補助コード",
    "金額(入力金額)", "消費税額", "消費税コード", "消費税率", "外税同時入力区分",
    "資金繰入力区分", "資金繰コード", "摘要",
    "固定摘要コード１", "固定摘要コード２", "固定摘要コード３", "固定摘要コード４", "固定摘要コード５",
    "期日", "付箋区分", "付箋コメント",
]


def _mas(rows: Sequence[RowView]) -> tuple[list[str], list[list[str]]]:
    out: list[list[str]] = []
    for r in rows:
        row = [""] * len(MAS_HEADERS)
        tax = tax_mas(r.tax_mode)
        row[0] = r.date           # 伝票日付
        row[12] = tax             # (借方)税込/税抜区分
        row[23] = tax             # (貸方)税込/税抜区分
        row[28] = r.amount        # 金額(入力金額)
        row[35] = r.description or r.vendor  # 摘要
        out.append(row)
    return list(MAS_HEADERS), out


FORMATTERS: dict[str, Callable[[Sequence[RowView]], tuple[list[str], list[list[str]]]]] = {
    "freee": _freee,
    "yayoi": _yayoi,
    "mas": _mas,
    "generic": _generic,
}


def build(target: str, rows: Sequence[RowView]) -> tuple[list[str], list[list[str]]]:
    return FORMATTERS.get(target, _generic)(rows)


def to_csv(headers: list[str], rows: list[list[str]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(headers)
    writer.writerows(rows)
    return buf.getvalue()
