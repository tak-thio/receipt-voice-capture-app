#!/usr/bin/env python3

import json
import os
import sys
import uuid


def load_faster_whisper():
    try:
        from faster_whisper import WhisperModel

        return WhisperModel
    except Exception as error:
        raise RuntimeError(
            "faster-whisper is not installed. Run `python3 -m pip install -r scripts/requirements-stt.txt` "
            "or provide seedText for scaffold mode."
        ) from error


def build_events(seed_text: str, duration_ms: int | None) -> list[dict[str, int | str]]:
    lines = [line.strip() for line in seed_text.splitlines() if line.strip()]
    if not lines:
        return []

    if duration_ms and duration_ms > 0:
        segment_duration = max(duration_ms // len(lines), 1)
    else:
        segment_duration = 1200

    events: list[dict[str, int | str]] = []
    for index, line in enumerate(lines):
        events.append(
            {
                "id": f"evt-{uuid.uuid4()}",
                "text": line,
                "startMs": index * segment_duration,
                "endMs": (index + 1) * segment_duration,
            }
        )

    return events


def transcribe_audio_file(audio_path: str) -> dict[str, object]:
    if not audio_path:
        raise ValueError("audioPath is required when seedText is not provided.")

    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file was not found: {audio_path}")

    whisper_model = load_faster_whisper()
    model_name = str(payload_value("sttModel", "RECEIPT_STT_MODEL", "small"))
    device = str(payload_value("sttDevice", "RECEIPT_STT_DEVICE", "cpu"))
    compute_type = str(payload_value("sttComputeType", "RECEIPT_STT_COMPUTE_TYPE", "int8"))
    language = str(payload_value("sttLanguage", "RECEIPT_STT_LANGUAGE", "ja"))
    beam_size = int(payload_value("sttBeamSize", "RECEIPT_STT_BEAM_SIZE", "5"))

    model = whisper_model(model_name, device=device, compute_type=compute_type)
    segments, info = model.transcribe(
        audio_path,
        beam_size=beam_size,
        language=language,
        condition_on_previous_text=False,
    )

    events: list[dict[str, int | str]] = []
    for segment in segments:
        text = str(getattr(segment, "text", "")).strip()
        if not text:
            continue
        events.append(
            {
                "id": f"evt-{uuid.uuid4()}",
                "text": text,
                "startMs": int(float(getattr(segment, "start", 0.0)) * 1000),
                "endMs": int(float(getattr(segment, "end", 0.0)) * 1000),
            }
        )

    return {
        "events": events,
        "source": "local-python-sidecar",
        "detectedLanguage": getattr(info, "language", language),
    }


CURRENT_PAYLOAD: dict[str, object] = {}


def payload_value(payload_key: str, env_key: str, default: object) -> object:
    payload_value = CURRENT_PAYLOAD.get(payload_key)
    if payload_value not in (None, ""):
        return payload_value
    env_value = os.environ.get(env_key)
    if env_value not in (None, ""):
        return env_value
    return default


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        global CURRENT_PAYLOAD
        CURRENT_PAYLOAD = payload
        seed_text = str(payload.get("seedText") or "").strip()
        audio_path = str(payload.get("audioPath") or "").strip()
        audio_duration_ms = payload.get("audioDurationMs")

        if not seed_text:
            response = transcribe_audio_file(audio_path)
            print(json.dumps(response, ensure_ascii=False))
            return 0

        response = {
            "events": build_events(seed_text, audio_duration_ms),
            "source": "local-python-sidecar",
            "detectedLanguage": str(payload.get("sttLanguage") or "").strip() or None,
        }
        print(json.dumps(response, ensure_ascii=False))
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
