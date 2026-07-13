"""Concrete AI providers.

Self-hosted (Ollama / faster-whisper) need no key and run on the VM host.
OpenAI / Gemini hit their HTTP APIs with the firm's key. A `mock` provider with
no external deps is included for dev/testing.
"""

from __future__ import annotations

import base64
import json
import re

import httpx

from ..config import get_settings
from .base import ExtractedReceipt, FormatProvider, OcrProvider, SttProvider

settings = get_settings()

# 抽出フィールド仕様（OCR/整形で共通＝全経路で一貫）。摘要(description)は AI に作らせる。
# vendor は「発行者(お店)」固定。宛名(支払った側=自社)と取り違えないよう明示する。
# ※税率が変わったら(例: 食料品1%) tax_lines の label 例をここに1文足すだけ(コード変更不要)。
_FIELDS_SPEC = (
    "キー: date(YYYY-MM-DD), "
    "vendor(領収書を発行した店舗・事業者の名称=代金を受け取った側。"
    "宛名や「上様」「御中」付きの支払った相手・自社名は vendor にしない。"
    "インボイス登録番号(T番号)が記載されていれば、それはこの発行者のもの), "
    "amount_jpy(日本円の税込合計,整数), "
    "subtotal_jpy(日本円の税抜金額,整数), tax_jpy(日本円の消費税合計,整数), "
    "currency(支払通貨のコード。USD等。日本円建てなら null), "
    "foreign_amount(外貨での支払総額,小数可。円建てなら null), "
    'tax_lines(消費税内訳の配列 [{"label":"10%","tax_jpy":800,"base_jpy":8000}]。'
    'label は書面に印字された税率の表記。通常は "10%" か "8%" だが、'
    "海外の請求では任意の率がありうる。tax_jpy(税額)と base_jpy(税抜対象額)は日本円で"
    "印字されている場合のみ入れる。【厳守】外貨建ての請求など、日本円で 税率×税抜対象額 が"
    "税額と検算できない場合は、書面に税率(10%等)の記載があっても label は説明文でも率でもなく"
    '必ず "その他" という3文字にする(率を書くと数字が合わず混乱するため。詳細は原本で確認できる)。'
    '非課税・対象外の行は label を "非課税"/"対象外" に), '
    "tax_mode(inclusive/exclusive/unknown), payment_method, t_number(インボイス番号), "
    "description(摘要: 会計仕訳に使える簡潔な説明。店名や主な品目・用途から30文字程度で作成。"
    "例『会議用 飲食代』『事務用品 購入』)。"
    "【重要】金額は書面に印字されている値だけを使うこと。計算・按分・通貨換算で金額を"
    "作ってはならない。外貨建て(USD等)の書面で日本円の合計が印字されていなければ "
    "amount_jpy/subtotal_jpy は必ず null(勝手に円換算しない)。"
    "値が不明なものは null。JSON以外は出力しないこと。"
)
_FORMAT_PROMPT = "次の領収書テキストから JSON で抽出してください。" + _FIELDS_SPEC + "\n\n"
_OCR_PROMPT = "この領収書画像に書かれている文字を、改行を保ちつつ全て書き出してください。"
# 全取込経路(モバイル/Web/Gmail)で共通の“唯一の”ビジョン抽出プロンプト。入力は画像または
# PDF(複数ページ)で、1入力に領収書0..N枚・カード利用明細(複数行)が含まれうる。全件を配列で返す。
_BATCH_PROMPT = (
    "番号付きの入力(画像またはPDF)が複数あります。各入力には領収書が0枚・1枚または複数枚、"
    "あるいはクレジットカードの利用明細(複数の利用行)が含まれます。"
    "PDFは全ページを対象に、含まれる領収書・利用明細の行を1件ずつ、すべて抽出してください。"
    "最後に音声がある場合、それは各領収書について話した説明メモです。"
    '出力は {"items": [ {...}, {...} ], "audio_transcript": "..."} の JSON だけ。items の各要素のキー: '
    "image_index(その項目が写っている入力の番号。1始まり), "
    "doc_type(通常の領収書は 'receipt'、カード利用明細の行は 'card_statement'), "
    + _FIELDS_SPEC
    + " カード明細の行は vendor に利用先、amount_jpy にご利用額(円)を入れ、税やt_numberは"
    "読めなければ null。明細の外貨行には『通貨名(USD等)・現地ご利用額(220.00等)・"
    "換算レート(165.49等)』の3つの列が並ぶ。値がある行は currency に通貨名、"
    "foreign_amount に現地ご利用額、exchange_rate に換算レートを小数のまま必ず入れる"
    "(3列とも空欄の国内行は null)。"
    "description は音声メモがあればその内容を踏まえて作成。"
    " audio_transcript には、音声があればその文字起こし全文を、無ければ空文字を入れる。"
    "領収書が無くても items は [] にし、audio_transcript は埋めること。"
)


def _json_from_text(text: str) -> dict:
    """Parse a JSON object out of an LLM response (handles ```json fences)."""
    fenced = re.search(r"\{.*\}", text, re.DOTALL)
    raw = fenced.group(0) if fenced else text
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def _int(v) -> int | None:
    try:
        return int(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _num(v) -> float | None:
    """小数を許す数値(現地ご利用額・換算レート)。"""
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _sanitize_tax_lines(v) -> list | None:
    """tax_lines を [{"label","tax_jpy","base_jpy"}] に正規化。空要素は捨てる。"""
    if not isinstance(v, list):
        return None
    out = []
    for e in v:
        if not isinstance(e, dict):
            continue
        label = str(e.get("label") or "").strip()
        line = {"label": label or None, "tax_jpy": _int(e.get("tax_jpy")), "base_jpy": _int(e.get("base_jpy"))}
        if line["label"] or line["tax_jpy"] is not None or line["base_jpy"] is not None:
            out.append(line)
    return out or None


def _to_extracted(data: dict) -> ExtractedReceipt:
    doc_type = data.get("doc_type")
    return ExtractedReceipt(
        vendor=data.get("vendor"),
        amount_jpy=_int(data.get("amount_jpy")),
        subtotal_jpy=_int(data.get("subtotal_jpy")),
        tax_jpy=_int(data.get("tax_jpy")),
        tax_lines=_sanitize_tax_lines(data.get("tax_lines")),
        currency=(str(data.get("currency")).strip().upper() or None) if data.get("currency") else None,
        foreign_amount=_num(data.get("foreign_amount")),
        exchange_rate=_num(data.get("exchange_rate")),
        # inclusive/exclusive 以外(unknown・空など)は不明(None)に正規化。編集/レビューの選択肢と揃える。
        tax_mode=data.get("tax_mode") if data.get("tax_mode") in ("inclusive", "exclusive") else None,
        payment_method=data.get("payment_method"),
        t_number=data.get("t_number"),
        date=data.get("date"),
        description=data.get("description"),
        doc_type="card_statement" if doc_type == "card_statement" else "receipt",
        image_index=max(0, (_int(data.get("image_index")) or 1) - 1),  # 1始まり→0始まり
        raw=data,
    )


# --- self-hosted (no external key) -----------------------------------------

class OllamaOcr(OcrProvider):
    def __init__(self, model: str | None = None) -> None:
        self.model = model or settings.ollama_vision_model

    async def extract_text(self, image: bytes, mime: str) -> str:
        b64 = base64.b64encode(image).decode()
        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(
                f"{settings.ollama_host}/api/generate",
                json={
                    "model": self.model,
                    "prompt": _OCR_PROMPT,
                    "images": [b64],
                    "think": False,  # qwen3 thinking models emit nothing otherwise
                    "stream": False,
                },
            )
            resp.raise_for_status()
            return resp.json().get("response", "")


class OllamaFormat(FormatProvider):
    def __init__(self, model: str | None = None) -> None:
        self.model = model or settings.ollama_text_model

    async def to_fields(self, text: str) -> ExtractedReceipt:
        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(
                f"{settings.ollama_host}/api/generate",
                json={
                    "model": self.model,
                    "prompt": f"{_FORMAT_PROMPT}{text}",
                    # Disable thinking (qwen3) and parse JSON out of the text; the
                    # `format: json` constraint returns empty on thinking models.
                    "think": False,
                    "stream": False,
                },
            )
            resp.raise_for_status()
            return _to_extracted(_json_from_text(resp.json().get("response", "{}")))


class WhisperStt(SttProvider):
    def __init__(self, model: str | None = None) -> None:
        self.model = model

    async def transcribe(self, audio: bytes, mime: str, language: str = "ja") -> str:
        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(
                f"{settings.whisper_host}/transcribe",
                files={"file": ("audio", audio, mime)},
                data={"language": language},
            )
            resp.raise_for_status()
            return resp.json().get("text", "")


# --- OpenAI ----------------------------------------------------------------

_OPENAI = "https://api.openai.com/v1"


class OpenAiStt(SttProvider):
    def __init__(self, key: str, model: str | None = None) -> None:
        self.key = key
        self.model = model or "gpt-4o-mini-transcribe"

    async def transcribe(self, audio: bytes, mime: str, language: str = "ja") -> str:
        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(
                f"{_OPENAI}/audio/transcriptions",
                headers={"Authorization": f"Bearer {self.key}"},
                files={"file": ("audio", audio, mime)},
                data={"model": self.model, "language": language},
            )
            resp.raise_for_status()
            return resp.json().get("text", "")


class OpenAiOcr(OcrProvider):
    def __init__(self, key: str, model: str | None = None) -> None:
        self.key = key
        self.model = model or "gpt-4o-mini"

    async def extract_text(self, image: bytes, mime: str) -> str:
        data_url = f"data:{mime or 'image/jpeg'};base64,{base64.b64encode(image).decode()}"
        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(
                f"{_OPENAI}/chat/completions",
                headers={"Authorization": f"Bearer {self.key}"},
                json={
                    "model": self.model,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": _OCR_PROMPT},
                                {"type": "image_url", "image_url": {"url": data_url}},
                            ],
                        }
                    ],
                },
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]


class OpenAiFormat(FormatProvider):
    def __init__(self, key: str, model: str | None = None) -> None:
        self.key = key
        self.model = model or "gpt-4o-mini"

    async def to_fields(self, text: str) -> ExtractedReceipt:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{_OPENAI}/chat/completions",
                headers={"Authorization": f"Bearer {self.key}"},
                json={
                    "model": self.model,
                    "response_format": {"type": "json_object"},
                    "messages": [{"role": "user", "content": f"{_FORMAT_PROMPT}{text}"}],
                },
            )
            resp.raise_for_status()
            return _to_extracted(_json_from_text(resp.json()["choices"][0]["message"]["content"]))


# --- Gemini ----------------------------------------------------------------

_GEMINI = "https://generativelanguage.googleapis.com/v1beta/models"


async def _gemini_generate(key: str, model: str, parts: list[dict]) -> str:
    # 多ページPDF/カード明細(複数ページを1回で読む)は時間がかかるため長め。
    # 10MB上限と組み合わせて、現実的な書類なら収まる範囲。
    async with httpx.AsyncClient(timeout=480) as client:
        resp = await client.post(
            f"{_GEMINI}/{model}:generateContent",
            params={"key": key},
            json={"contents": [{"parts": parts}]},
        )
        resp.raise_for_status()
        cands = resp.json().get("candidates", [])
        if not cands:
            return ""
        return "".join(p.get("text", "") for p in cands[0]["content"]["parts"])


class GeminiStt(SttProvider):
    def __init__(self, key: str, model: str | None = None) -> None:
        self.key = key
        self.model = model or "gemini-2.5-flash"

    async def transcribe(self, audio: bytes, mime: str, language: str = "ja") -> str:
        parts = [
            {"text": "この音声を文字起こししてください。"},
            {"inline_data": {"mime_type": mime or "audio/mp4", "data": base64.b64encode(audio).decode()}},
        ]
        return await _gemini_generate(self.key, self.model, parts)


class GeminiOcr(OcrProvider):
    def __init__(self, key: str, model: str | None = None) -> None:
        self.key = key
        self.model = model or "gemini-2.5-flash"

    async def extract_text(self, image: bytes, mime: str) -> str:
        parts = [
            {"text": _OCR_PROMPT},
            {"inline_data": {"mime_type": mime or "image/jpeg", "data": base64.b64encode(image).decode()}},
        ]
        return await _gemini_generate(self.key, self.model, parts)

    async def extract_batch(
        self, images: list[tuple[bytes, str]], audio: bytes | None, audio_mime: str
    ) -> list[ExtractedReceipt] | None:
        # One Gemini call: N images (numbered) + optional voice memo -> all
        # receipts/statement-lines as a flat array (multi-per-image supported).
        parts: list[dict] = [{"text": _BATCH_PROMPT}]
        for idx, (img, mime) in enumerate(images, start=1):
            parts.append({"text": f"画像 {idx}:"})
            parts.append(
                {"inline_data": {"mime_type": mime or "image/jpeg", "data": base64.b64encode(img).decode()}}
            )
        if audio is not None:
            parts.append({"text": "音声メモ:"})
            parts.append(
                {"inline_data": {"mime_type": audio_mime or "audio/mp4", "data": base64.b64encode(audio).decode()}}
            )
        out = await _gemini_generate(self.key, self.model, parts)
        obj = _json_from_text(out)
        items = obj.get("items")
        if not isinstance(items, list):
            return None
        transcript = (obj.get("audio_transcript") or "").strip() or None
        results: list[ExtractedReceipt] = []
        for it in items:
            if isinstance(it, dict):
                ex = _to_extracted(it)
                ex.audio_transcript = transcript
                results.append(ex)
        return results


class GeminiFormat(FormatProvider):
    def __init__(self, key: str, model: str | None = None) -> None:
        self.key = key
        self.model = model or "gemini-2.5-flash"

    async def to_fields(self, text: str) -> ExtractedReceipt:
        out = await _gemini_generate(self.key, self.model, [{"text": f"{_FORMAT_PROMPT}{text}"}])
        return _to_extracted(_json_from_text(out))


# --- mock (no external deps; for dev/testing the pipeline) ------------------

class MockStt(SttProvider):
    def __init__(self, model: str | None = None) -> None:
        self.model = model

    async def transcribe(self, audio: bytes, mime: str, language: str = "ja") -> str:
        return "テスト商店で打ち合わせ 千五百円 現金"


class MockOcr(OcrProvider):
    def __init__(self, model: str | None = None) -> None:
        self.model = model

    async def extract_text(self, image: bytes, mime: str) -> str:
        return "領収書 テスト商店 ¥1,500 現金"

    async def extract_batch(
        self, images: list[tuple[bytes, str]], audio: bytes | None, audio_mime: str
    ) -> list[ExtractedReceipt]:
        # 画像ごとに2件返す(複数領収書のテスト用)。音声があれば摘要に印を付ける。
        note = "音声メモ反映 " if audio is not None else ""
        transcript = "テスト音声の文字起こし" if audio is not None else None
        out: list[ExtractedReceipt] = []
        for i in range(len(images)):
            for j in range(2):
                ex = _to_extracted(
                    {
                        "image_index": i + 1,
                        "doc_type": "receipt",
                        "vendor": f"テスト商店{i + 1}-{j + 1}",
                        "amount_jpy": 1000 + j,
                        "date": "2026-06-14",
                        "description": f"{note}摘要 {i + 1}-{j + 1}",
                    }
                )
                ex.audio_transcript = transcript
                out.append(ex)
        return out


class MockFormat(FormatProvider):
    def __init__(self, model: str | None = None) -> None:
        self.model = model

    async def to_fields(self, text: str) -> ExtractedReceipt:
        return _to_extracted(
            {
                "vendor": "テスト商店",
                "amount_jpy": 1500,
                "subtotal_jpy": 1364,
                "tax_jpy": 136,
                "tax_mode": "inclusive",
                "payment_method": "cash",
                "date": "2026-06-05",
                "description": "テスト商店 物品購入",
            }
        )
