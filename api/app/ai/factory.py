"""Build capability providers from a firm's ai_config.

ai_config shape:
  { "stt":    {"provider": "openai|gemini|whisper", "key_enc": "..."},
    "ocr":    {"provider": "ollama|openai|gemini",  "key_enc": "..."},
    "format": {"provider": "ollama|openai|gemini",  "key_enc": "..."} }

Self-hosted providers (ollama/whisper) ignore key_enc.
"""

from __future__ import annotations

from ..security import decrypt_secret
from .base import FormatProvider, OcrProvider, SttProvider
from . import providers as p

_STT = {"openai": p.OpenAiStt, "gemini": p.GeminiStt, "whisper": p.WhisperStt}
_OCR = {"ollama": p.OllamaOcr, "openai": p.OpenAiOcr, "gemini": p.GeminiOcr}
_FORMAT = {"ollama": p.OllamaFormat, "openai": p.OpenAiFormat, "gemini": p.GeminiFormat}

_SELF_HOSTED = {"ollama", "whisper"}


def _build(registry: dict, cfg: dict):
    provider = (cfg or {}).get("provider")
    cls = registry.get(provider)
    if cls is None:
        raise ValueError(f"unsupported provider: {provider!r}")
    if provider in _SELF_HOSTED:
        return cls()
    key_enc = cfg.get("key_enc")
    if not key_enc:
        raise ValueError(f"provider {provider!r} requires an encrypted key")
    return cls(decrypt_secret(key_enc))


def stt_for(ai_config: dict) -> SttProvider:
    return _build(_STT, (ai_config or {}).get("stt", {}))


def ocr_for(ai_config: dict) -> OcrProvider:
    return _build(_OCR, (ai_config or {}).get("ocr", {}))


def format_for(ai_config: dict) -> FormatProvider:
    return _build(_FORMAT, (ai_config or {}).get("format", {}))
