#!/usr/bin/env python3

import json
import sys
import uuid


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


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        seed_text = str(payload.get("seedText") or "").strip()
        audio_path = str(payload.get("audioPath") or "").strip()
        audio_duration_ms = payload.get("audioDurationMs")

        if not seed_text:
            raise ValueError(
                "Python STT sidecar is running, but no seedText was provided yet. "
                f"Captured audio is available at: {audio_path}"
            )

        response = {
            "events": build_events(seed_text, audio_duration_ms),
            "source": "local-python-sidecar",
        }
        print(json.dumps(response, ensure_ascii=False))
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
