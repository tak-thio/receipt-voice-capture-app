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
    doc_type: str = "receipt"  # 'receipt' | 'card_statement'(カード利用明細の1行)
    image_index: int = 0  # バッチ抽出時、何番目の画像由来か(0始まり)
    audio_transcript: str | None = None  # 撮影セットの音声メモの文字起こし(セット共通)
    raw: dict = field(default_factory=dict)


class SttProvider(ABC):
    @abstractmethod
    async def transcribe(self, audio: bytes, mime: str, language: str = "ja") -> str:
        """Audio bytes -> transcript text."""


class OcrProvider(ABC):
    @abstractmethod
    async def extract_text(self, image: bytes, mime: str) -> str:
        """Image bytes -> raw OCR text."""

    async def extract_batch(
        self, images: list[tuple[bytes, str]], audio: bytes | None, audio_mime: str
    ) -> list[ExtractedReceipt] | None:
        """One multimodal call over a capture SET: N images (in order) plus an
        optional voice narration covering them. Returns one ExtractedReceipt per
        receipt found — a single image may yield several (multiple receipts laid
        out, or a credit-card statement where each line is one item). Each result
        carries image_index (which source image) and doc_type. description is
        drawn from the voice memo when present. No separate STT step — the audio
        goes straight to the model. Return None if the provider can't do this
        (the caller treats that as an explicit error)."""
        return None


class FormatProvider(ABC):
    @abstractmethod
    async def to_fields(self, text: str) -> ExtractedReceipt:
        """Free text (STT/OCR) -> structured receipt fields."""
