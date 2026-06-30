"""Cold-start keyword -> account-category dictionary.

Ported from mobile/dictionaries/description-mapping.json. Used as a fallback in
journaling.suggest(): a pattern found in the receipt's vendor/OCR text maps to an
account-category NAME, which is resolved to the client's account_title by name.
Gives sensible suggestions before any per-顧問先 learning has accumulated.
"""

# (pattern, account_category_name, confidence)
DESCRIPTION_MAP: list[tuple[str, str, float]] = [
    ("文具代", "消耗品費", 0.95),
    ("事務用品", "消耗品費", 0.95),
    ("USBケーブル", "消耗品費", 0.85),
    ("駐車場代", "旅費交通費", 0.95),
    ("高速代", "旅費交通費", 0.95),
    ("電車代", "旅費交通費", 0.95),
    ("バス代", "旅費交通費", 0.95),
    ("タクシー代", "旅費交通費", 0.95),
    ("ガソリン代", "旅費交通費", 0.80),
    ("飲食代", "接待交際費", 0.70),
    ("会議用飲料", "会議費", 0.90),
    ("打ち合わせ", "会議費", 0.80),
    ("書籍代", "新聞図書費", 0.95),
    ("雑誌代", "新聞図書費", 0.95),
    ("切手代", "通信費", 0.95),
    ("電話代", "通信費", 0.95),
    ("ネット代", "通信費", 0.90),
    ("宅配便", "荷造運賃", 0.95),
    ("送料", "荷造運賃", 0.90),
    ("サーバー代", "ソフトウェア利用料", 0.90),
    ("ドメイン代", "ソフトウェア利用料", 0.90),
    ("振込手数料", "支払手数料", 0.98),
    ("印紙代", "租税公課", 0.95),
    ("広告費", "広告宣伝費", 0.98),
    ("外注費", "外注工賃", 0.98),
]


def match_category(text: str) -> str | None:
    """Return the highest-confidence account-category name whose pattern appears."""
    if not text:
        return None
    best: tuple[float, str] | None = None
    for pattern, category, confidence in DESCRIPTION_MAP:
        if pattern in text and (best is None or confidence > best[0]):
            best = (confidence, category)
    return best[1] if best else None
