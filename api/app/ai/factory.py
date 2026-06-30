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

_STT = {"openai": p.OpenAiStt, "gemini": p.GeminiStt, "whisper": p.WhisperStt, "mock": p.MockStt}
_OCR = {"ollama": p.OllamaOcr, "openai": p.OpenAiOcr, "gemini": p.GeminiOcr, "mock": p.MockOcr}
_FORMAT = {
    "ollama": p.OllamaFormat, "openai": p.OpenAiFormat, "gemini": p.GeminiFormat, "mock": p.MockFormat,
}

# Providers that need no external API key.
_SELF_HOSTED = {"ollama", "whisper", "mock"}


def _build(registry: dict, cfg: dict):
    provider = (cfg or {}).get("provider")
    cls = registry.get(provider)
    if cls is None:
        raise ValueError(f"unsupported provider: {provider!r}")
    model = cfg.get("model")
    if provider in _SELF_HOSTED:
        return cls(model=model)
    # 平文 key(無料プラン用の .env キー等)を優先。無ければ暗号化済み key_enc を復号。
    key = cfg.get("key")
    if not key:
        key_enc = cfg.get("key_enc")
        key = decrypt_secret(key_enc) if key_enc else None
    if not key:
        raise ValueError(f"provider {provider!r} requires an API key")
    return cls(key, model)


def stt_for(ai_config: dict) -> SttProvider:
    return _build(_STT, (ai_config or {}).get("stt", {}))


def ocr_for(ai_config: dict) -> OcrProvider:
    return _build(_OCR, (ai_config or {}).get("ocr", {}))


def format_for(ai_config: dict) -> FormatProvider:
    return _build(_FORMAT, (ai_config or {}).get("format", {}))
