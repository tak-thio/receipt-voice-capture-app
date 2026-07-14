"""Standard 勘定科目 chart: firm template + per-client copy.

- A firm gets the standard chart as its template (client_id = NULL) at
  registration (seed_firm_template).
- Each new 顧問先 gets its OWN editable copy of the standard chart at creation
  (seed_client_chart), so staff can customize per client without touching the
  firm template. Copied rows set override_of to the matching template row so the
  template+override overlay (see masters router) shows the client's copy, not a
  duplicate.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import AccountTitle

# A practical SME standard chart of accounts (code, name). Codes are illustrative
# defaults the firm can edit. Grouped: assets / liabilities / equity / revenue /
# expenses. Expense codes 758-790 kept from the original seed for continuity.
STANDARD_CHART: list[tuple[str, str]] = [
    # 資産
    ("100", "現金"),
    ("101", "普通預金"),
    ("102", "当座預金"),
    ("135", "売掛金"),
    ("140", "棚卸資産"),
    ("150", "前払金"),
    ("160", "仮払金"),
    ("170", "立替金"),
    ("180", "未収入金"),
    ("200", "建物"),
    ("210", "車両運搬具"),
    ("220", "工具器具備品"),
    ("230", "ソフトウェア"),
    # 負債
    ("300", "買掛金"),
    ("305", "未払金"),
    ("310", "未払費用"),
    ("315", "前受金"),
    ("320", "預り金"),
    ("330", "短期借入金"),
    ("335", "長期借入金"),
    ("340", "未払法人税等"),
    ("345", "未払消費税等"),
    # 純資産
    ("400", "資本金"),
    ("410", "繰越利益剰余金"),
    # 収益
    ("500", "売上"),
    ("510", "雑収入"),
    ("515", "受取利息"),
    # 費用
    ("600", "仕入"),
    ("750", "給料手当"),
    ("751", "法定福利費"),
    ("752", "減価償却費"),
    ("753", "修繕費"),
    ("754", "保険料"),
    ("755", "租税公課"),
    ("756", "リース料"),
    ("758", "旅費交通費"),
    ("759", "消耗品費"),
    ("760", "通信費"),
    ("761", "接待交際費"),
    ("762", "会議費"),
    ("763", "新聞図書費"),
    ("764", "荷造運賃"),
    ("765", "支払手数料"),
    ("766", "水道光熱費"),
    ("767", "地代家賃"),
    ("768", "広告宣伝費"),
    ("769", "福利厚生費"),
    ("790", "雑費"),
]

# 「よく使う」の初期値: 新しい会社/顧問先の仕分けUIに既定表示する科目(後から画面で自由に変更可)。
# ピンが1つも無いとUIは全科目(約45個)を並べるため、領収書経費の定番を最初から絞って出す。
# 借方=経費の定番10 / 貸方=支払手段。
PINNED_DEBIT_CODES = {
    "758",  # 旅費交通費
    "759",  # 消耗品費
    "760",  # 通信費
    "761",  # 接待交際費
    "762",  # 会議費
    "765",  # 支払手数料
    "766",  # 水道光熱費
    "767",  # 地代家賃
    "769",  # 福利厚生費
    "790",  # 雑費
}
PINNED_CREDIT_CODES = {
    "100",  # 現金
    "101",  # 普通預金
    "305",  # 未払金(クレジットカード払いの相手科目)
    "300",  # 買掛金
}


async def seed_firm_template(session: AsyncSession, firm_id: UUID) -> None:
    """Insert the standard chart as a firm's template (client_id = NULL).

    Caller must have bound the RLS context to a firm member (WITH CHECK).
    """
    for order, (code, name) in enumerate(STANDARD_CHART):
        session.add(
            AccountTitle(
                firm_id=firm_id,
                client_id=None,
                code=code,
                name=name,
                sort_order=order,
                pinned_debit=code in PINNED_DEBIT_CODES,
                pinned_credit=code in PINNED_CREDIT_CODES,
            )
        )


async def seed_client_chart(
    session: AsyncSession, firm_id: UUID, client_id: UUID
) -> None:
    """Copy the standard chart into a new client as its own editable rows.

    For codes that exist in the firm template, set override_of to that template
    row so the overlay hides the inherited duplicate; codes not in the template
    become plain client rows. Caller must have flushed the client first (so RLS
    app_client_access() can see it) and bound the RLS context to a firm member.
    """
    rows = await session.execute(
        select(AccountTitle.id, AccountTitle.code).where(
            AccountTitle.firm_id == firm_id, AccountTitle.client_id.is_(None)
        )
    )
    template_by_code = {code: tid for tid, code in rows.all()}
    for order, (code, name) in enumerate(STANDARD_CHART):
        session.add(
            AccountTitle(
                firm_id=firm_id,
                client_id=client_id,
                code=code,
                name=name,
                sort_order=order,
                override_of=template_by_code.get(code),
                pinned_debit=code in PINNED_DEBIT_CODES,
                pinned_credit=code in PINNED_CREDIT_CODES,
            )
        )
