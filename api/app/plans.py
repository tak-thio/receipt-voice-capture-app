"""プラン(料金)と月間解析枚数の上限。

- free     : 個人・無料(月30枚)
- pro      : 個人・サブスク(月500枚, ¥3,000/月。ストアIAP)
- business : 会社所属(B2B)。上限なし(契約)。経費精算が使えるのは business のみ。
"""

PLAN_FREE = "free"
PLAN_PRO = "pro"
PLAN_BUSINESS = "business"

# 月間の解析枚数上限。None = 無制限(会社)。
MONTHLY_CAP: dict[str, int | None] = {
    PLAN_FREE: 30,
    PLAN_PRO: 500,
    PLAN_BUSINESS: None,
}


def monthly_cap(plan: str | None) -> int | None:
    """そのプランの月間解析上限(None=無制限)。未知のプランは安全側で無料(30)扱い。"""
    if plan in MONTHLY_CAP:
        return MONTHLY_CAP[plan]
    return MONTHLY_CAP[PLAN_FREE]


def is_business(plan: str | None) -> bool:
    return plan == PLAN_BUSINESS
