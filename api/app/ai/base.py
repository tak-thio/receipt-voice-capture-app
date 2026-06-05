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
    amount_jpy: int | None = None
    tax_mode: str | None = None
    payment_method: str | None = None
    t_number: str | None = None
    date: str | None = None
    raw: dict = field(default_factory=dict)


class SttProvider(ABC):
    @abstractmethod
    async def transcribe(self, audio: bytes, mime: str, language: str = "ja") -> str:
        """Audio bytes -> transcript text."""


class OcrProvider(ABC):
    @abstractmethod
    async def extract_text(self, image: bytes, mime: str) -> str:
        """Image bytes -> raw OCR text."""


class FormatProvider(ABC):
    @abstractmethod
    async def to_fields(self, text: str) -> ExtractedReceipt:
        """Free text (STT/OCR) -> structured receipt fields."""
