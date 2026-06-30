#!/usr/bin/env bash
# 直近ビルドの AAB を Google Play の internal トラックに自動アップロードする。
#   使い方:  mobile/scripts/upload-internal.sh [aab_path] [track]
#   既定 aab: src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab
#   既定 track: internal
# 前提:
#   - ~/.android-keystores/play-sa.json (サービスアカウント鍵。$PLAY_SA_KEY で上書き可)
#   - SA に Play Console「テストトラックへのリリース」権限
# venv(google-api-python-client)は初回に自動作成する。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AAB="${1:-$DIR/../src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab}"
TRACK="${2:-internal}"
VENV="${PLAY_VENV:-$HOME/.android-keystores/play-venv}"

[ -f "$AAB" ] || { echo "AAB not found: $AAB" >&2; exit 1; }
if [ ! -x "$VENV/bin/python" ]; then
  echo "[setup] creating venv + installing google-api-python-client ..." >&2
  python3 -m venv "$VENV"
  "$VENV/bin/pip" -q install google-api-python-client google-auth
fi
echo "[upload] $AAB -> $TRACK" >&2
exec "$VENV/bin/python" "$DIR/play_upload.py" "$AAB" "$TRACK"
