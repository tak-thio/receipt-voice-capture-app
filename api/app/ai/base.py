"""AI capability interfaces.

Each capability (STT / OCR / Format) is a separate provider so a firm can mix,
e.g. self-hosted Ollama for OCR + OpenAI for STT. Providers are selected per
firm via firms.ai_config and built by ai.factory.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class ExtractedReceipt:
    """Structured fields parsed from a receipt (the `format` step output)."""

    vendor: str | None = None
    amount_jpy: int | None = None  # 合計金額(税込)
    subtotal_jpy: int | None = None  # 税抜金額
    tax_jpy: int | None = None  # 消費税合計
    tax_10_jpy: int | None = None  # 消費税(10%対象分)
    tax_8_jpy: int | None = None  # 消費税(8%対象分)
    tax_mode: str | None = None
    payment_method: str | None = None
    t_number: str | None = None
    date: str | None = None
    description: str | None = None  # 摘要 (仕訳の説明)
    raw: dict = field(default_factory=dict)


class SttProvider(ABC):
    @abstractmethod
    async def transcribe(self, audio: bytes, mime: str, language: str = "ja") -> str:
        """Audio bytes -> transcript text."""


class OcrProvider(ABC):
    @abstractmethod
    async def extract_text(self, image: bytes, mime: str) -> str:
        """Image bytes -> raw OCR text."""

    async def extract_fields(self, image: bytes, mime: str) -> ExtractedReceipt | None:
        """Optional one-call path: a vision LLM can read the image AND return
        structured fields directly, making a separate `format` step unnecessary.
        Return None if unsupported (the caller falls back to extract_text + format)."""
        return None


class FormatProvider(ABC):
    @abstractmethod
    async def to_fields(self, text: str) -> ExtractedReceipt:
        """Free text (STT/OCR) -> structured receipt fields."""
