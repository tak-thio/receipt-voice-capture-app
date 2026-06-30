# Windows動作確認チェックリスト

Windowsでこのアプリを確認するときの手順と、失敗時に見る場所の一覧。

## 事前確認

- [ ] Windows 10/11である
- [ ] WebView2 Runtime が入っている
- [ ] Visual Studio Build Tools のC++ビルドツールが入っている
- [ ] Node.js / npm が使える
- [ ] Rust / Cargo が使える
- [ ] Git cloneしたパスに日本語や空白が含まれていてもよいが、失敗時は `C:\dev\receipt-voice-capture-app` など短いASCIIパスでも試す

確認コマンド:

```powershell
node -v
npm -v
rustc --version
cargo --version
```

## 初回セットアップ

```powershell
git clone https://github.com/tak-thio/receipt-voice-capture-app.git
cd receipt-voice-capture-app
npm install
```

## ビルド前チェック

```powershell
npm run typecheck
npm test
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

## アプリ起動

```powershell
npm run app:test
```

起動後に確認すること:

- [ ] 設定画面が開ける
- [ ] `Gemini APIキー` または `OpenAI APIキー` を保存できる
- [ ] AI診断を更新して、選択中プロバイダーが `利用可能` になる
- [ ] テスト入力でレコードが作成できる
- [ ] カメラとマイクの権限要求が出る
- [ ] 録音後、音声ファイルが保存される
- [ ] GeminiまたはOpenAI STTで文字起こしできる
- [ ] Gemini OCRまたはローカルOCRで画像からテキスト取得できる
- [ ] レビュー画面で編集できる
- [ ] エクスポート画面でCSV保存ダイアログが出る
- [ ] CSVがWindowsの任意フォルダに保存できる

## ローカルSTT確認

ローカルSTTは必須ではない。AI APIでSTTする場合はこの項目を飛ばしてよい。

```powershell
py -m venv .venv-stt
.\.venv-stt\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r scripts\requirements-stt.txt
```

設定画面で `STTモード` を `ローカル` にし、診断欄で `.venv-stt\Scripts\python.exe` が検出されることを確認する。

## よくある失敗箇所

- `npm install` が失敗する: Node/npmのバージョン、ネットワーク、パス長を確認する
- `cargo check` が失敗する: Visual Studio Build Tools のC++環境を確認する
- `npm run app:test` でWebViewが開かない: WebView2 Runtimeを確認する
- APIキー診断が未設定: 設定画面で保存したあと、AI診断を再実行する
- カメラ/マイクが使えない: Windowsのプライバシー設定でデスクトップアプリのカメラ/マイク許可を確認する
- ローカルOCRが使えない: Tesseractが未インストールの場合はGemini OCRを使う
- ローカルSTTが使えない: `.venv-stt\Scripts\python.exe` が存在するか、`faster-whisper` が入っているか確認する

## 失敗ログとして残すもの

- 実行したコマンド
- エラー全文
- `node -v`
- `npm -v`
- `rustc --version`
- `cargo --version`
- Windowsのバージョン
- clone先のパス

## 修正タスク

- [ ] Windows実機で `npm install` を確認する
- [ ] Windows実機で `npm run typecheck` / `npm test` を確認する
- [ ] Windows実機で `cargo check` / `cargo test` を確認する
- [ ] Windows実機で `npm run app:test` を確認する
- [ ] Windows実機で設定画面からAPIキー保存、AI診断、AI整形テストを確認する
- [ ] Windows実機で録音保存、STT、OCR、CSVエクスポートを確認する
- [ ] Windowsで相対保存先 `receipt-sessions` の実際の作成場所を確認し、必要ならアプリデータフォルダへ移す
- [ ] WindowsでTauriの `npm run tauri build` を確認する
