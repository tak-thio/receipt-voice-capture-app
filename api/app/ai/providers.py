"""Concrete AI providers.

Scaffold note: OCR/format for Ollama and STT for whisper mirror receipt-app's
host-resident setup; OpenAI/Gemini hit their HTTP APIs with the firm's key.
Bodies are intentionally thin — the real prompts/schemas are ported in Phase 1.
"""

from __future__ import annotations

import json

import httpx

from ..config import get_settings
from .base import ExtractedReceipt, FormatProvider, OcrProvider, SttProvider

settings = get_settings()

_FORMAT_PROMPT = (
    "次の領収書テキストから日付(date, YYYY-MM-DD), 支払先(vendor), 金額(amount_jpy, 整数), "
    "税区分(tax_mode), 支払方法(payment_method), インボイス番号(t_number)をJSONで抽出してください。"
)


# --- self-hosted (no external key) -----------------------------------------

class OllamaOcr(OcrProvider):
    async def extract_text(self, image: bytes, mime: str) -> str:
        # TODO(port): receipt-app card_statement.py — send image to qwen2.5vl.
        raise NotImplementedError("Ollama OCR not wired yet (Phase 1)")


class OllamaFormat(FormatProvider):
    async def to_fields(self, text: str) -> ExtractedReceipt:
        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(
                f"{settings.ollama_host}/api/generate",
                json={
                    "model": settings.ollama_text_model,
                    "prompt": f"{_FORMAT_PROMPT}\n\n{text}",
                    "format": "json",
                    "stream": False,
                },
            )
            resp.raise_for_status()
            data = json.loads(resp.json().get("response", "{}"))
        return _to_extracted(data)


class WhisperStt(SttProvider):
    async def transcribe(self, audio: bytes, mime: str, language: str = "ja") -> str:
        # TODO(port): faster-whisper sidecar (server-side) — HTTP transcribe.
        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(
                f"{settings.whisper_host}/transcribe",
                files={"file": ("audio", audio, mime)},
                data={"language": language},
            )
            resp.raise_for_status()
            return resp.json().get("text", "")


# --- external API (firm-provided key) --------------------------------------

class OpenAiStt(SttProvider):
    def __init__(self, key: str) -> None:
        self.key = key

    async def transcribe(self, audio: bytes, mime: str, language: str = "ja") -> str:
        # TODO(port): mobile stt.rs OpenAI path — /v1/audio/transcriptions.
        raise NotImplementedError("OpenAI STT not wired yet (Phase 1)")


class GeminiStt(SttProvider):
    def __init__(self, key: str) -> None:
        self.key = key

    async def transcribe(self, audio: bytes, mime: str, language: str = "ja") -> str:
        raise NotImplementedError("Gemini STT not wired yet (Phase 1)")


class OpenAiOcr(OcrProvider):
    def __init__(self, key: str) -> None:
        self.key = key

    async def extract_text(self, image: bytes, mime: str) -> str:
        raise NotImplementedError("OpenAI OCR not wired yet (Phase 1)")


class GeminiOcr(OcrProvider):
    def __init__(self, key: str) -> None:
        self.key = key

    async def extract_text(self, image: bytes, mime: str) -> str:
        raise NotImplementedError("Gemini OCR not wired yet (Phase 1)")


class OpenAiFormat(FormatProvider):
    def __init__(self, key: str) -> None:
        self.key = key

    async def to_fields(self, text: str) -> ExtractedReceipt:
        raise NotImplementedError("OpenAI format not wired yet (Phase 1)")


class GeminiFormat(FormatProvider):
    def __init__(self, key: str) -> None:
        self.key = key

    async def to_fields(self, text: str) -> ExtractedReceipt:
        raise NotImplementedError("Gemini format not wired yet (Phase 1)")


def _to_extracted(data: dict) -> ExtractedReceipt:
    amount = data.get("amount_jpy")
    try:
        amount = int(amount) if amount is not None else None
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
