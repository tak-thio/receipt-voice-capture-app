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

_FORMAT_PROMPT = (
    "次の領収書テキストから JSON で抽出してください。"
    'キー: date(YYYY-MM-DD), vendor(支払先), amount_jpy(整数), '
    "tax_mode(inclusive/exclusive/unknown), payment_method, t_number(インボイス番号)。"
    "値が不明なものは null。JSON以外は出力しないこと。\n\n"
)
_OCR_PROMPT = "この領収書画像に書かれている文字を、改行を保ちつつ全て書き出してください。"


def _json_from_text(text: str) -> dict:
    """Parse a JSON object out of an LLM response (handles ```json fences)."""
    fenced = re.search(r"\{.*\}", text, re.DOTALL)
    raw = fenced.group(0) if fenced else text
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def _to_extracted(data: dict) -> ExtractedReceipt:
    amount = data.get("amount_jpy")
    try:
        amount = int(amount) if amount not in (None, "") else None
    except (TypeError, ValueError):
        amount = None
    return ExtractedReceipt(
        vendor=data.get("vendor"),
        amount_jpy=amount,
        tax_mode=data.get("tax_mode"),
        payment_method=data.get("payment_method"),
        t_number=data.get("t_number"),
        date=data.get("date"),
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
    async with httpx.AsyncClient(timeout=180) as client:
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


class MockFormat(FormatProvider):
    def __init__(self, model: str | None = None) -> None:
        self.model = model

    async def to_fields(self, text: str) -> ExtractedReceipt:
        return _to_extracted(
            {
                "vendor": "テスト商店",
                "amount_jpy": 1500,
                "tax_mode": "inclusive",
                "payment_method": "cash",
                "date": "2026-06-05",
            }
        )
