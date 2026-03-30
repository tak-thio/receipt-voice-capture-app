# Local STT Setup

`local STT` は Python sidecar から `faster-whisper` を呼び出す構成で準備している。

## 最小セットアップ

```bash
python3 -m venv .venv-stt
source .venv-stt/bin/activate
python -m pip install --upgrade pip
python -m pip install -r scripts/requirements-stt.txt
```

`./.venv-stt/bin/python` が存在する場合、Tauri backend はこの Python を自動で優先する。

## 推奨環境変数

```bash
export RECEIPT_STT_PYTHON="/absolute/path/to/.venv-stt/bin/python"
export RECEIPT_STT_MODEL="small"
export RECEIPT_STT_DEVICE="cpu"
export RECEIPT_STT_COMPUTE_TYPE="int8"
export RECEIPT_STT_LANGUAGE="ja"
export RECEIPT_STT_BEAM_SIZE="5"
```

## メモ

- `faster-whisper` は `WhisperModel(...).transcribe(...)` を使う。
- モデル名を `"small"` のように渡すと、対応する CTranslate2 モデルは Hugging Face Hub から自動取得される。
- CPU では `int8`、GPU では `float16` または `int8_float16` を候補にする。
- GPU 実行時は CUDA / cuDNN 側の追加要件がある。

## 疎通確認例

```bash
say -v Kyoko "三月二十四日 セブンイレブン 税込千百五十八円 現金 次へ" -o /tmp/receipt-stt-sample.aiff
.venv-stt/bin/python scripts/stt_sidecar.py <<'EOF'
{"audioPath":"/tmp/receipt-stt-sample.aiff","sttModel":"tiny","sttDevice":"cpu","sttComputeType":"int8","sttLanguage":"ja","sttBeamSize":1}
EOF
```
