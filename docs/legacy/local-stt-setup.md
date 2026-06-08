# Local STT Setup

`local STT` は Python sidecar から `faster-whisper` を呼び出す構成で準備している。

## 最小セットアップ

Mac / Linux:

```bash
python3 -m venv .venv-stt
source .venv-stt/bin/activate
python -m pip install --upgrade pip
python -m pip install -r scripts/requirements-stt.txt
```

Windows PowerShell:

```powershell
py -m venv .venv-stt
.\.venv-stt\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r scripts\requirements-stt.txt
```

Tauri backend は `./.venv-stt/bin/python` と `./.venv-stt/Scripts/python.exe` を自動で探す。

## 推奨環境変数

Mac / Linux:

```bash
export RECEIPT_STT_PYTHON="/absolute/path/to/.venv-stt/bin/python"
export RECEIPT_STT_MODEL="small"
export RECEIPT_STT_DEVICE="cpu"
export RECEIPT_STT_COMPUTE_TYPE="int8"
export RECEIPT_STT_LANGUAGE="ja"
export RECEIPT_STT_BEAM_SIZE="5"
```

Windows PowerShell:

```powershell
$env:RECEIPT_STT_PYTHON="C:\absolute\path\to\.venv-stt\Scripts\python.exe"
$env:RECEIPT_STT_MODEL="small"
$env:RECEIPT_STT_DEVICE="cpu"
$env:RECEIPT_STT_COMPUTE_TYPE="int8"
$env:RECEIPT_STT_LANGUAGE="ja"
$env:RECEIPT_STT_BEAM_SIZE="5"
```

## メモ

- `faster-whisper` は `WhisperModel(...).transcribe(...)` を使う。
- モデル名を `"small"` のように渡すと、対応する CTranslate2 モデルは Hugging Face Hub から自動取得される。
- CPU では `int8`、GPU では `float16` または `int8_float16` を候補にする。
- GPU 実行時は CUDA / cuDNN 側の追加要件がある。

## 疎通確認例

Mac専用の音声生成例:

```bash
say -v Kyoko "三月二十四日 セブンイレブン 税込千百五十八円 現金 次へ" -o /tmp/receipt-stt-sample.aiff
.venv-stt/bin/python scripts/stt_sidecar.py <<'EOF'
{"audioPath":"/tmp/receipt-stt-sample.aiff","sttModel":"tiny","sttDevice":"cpu","sttComputeType":"int8","sttLanguage":"ja","sttBeamSize":1}
EOF
```

Windowsでは任意の `wav` / `m4a` / `webm` ファイルを用意し、PowerShellで次のように確認する。

```powershell
'{"audioPath":"C:\\absolute\\path\\to\\sample.wav","sttModel":"tiny","sttDevice":"cpu","sttComputeType":"int8","sttLanguage":"ja","sttBeamSize":1}' | .\.venv-stt\Scripts\python.exe scripts\stt_sidecar.py
```
