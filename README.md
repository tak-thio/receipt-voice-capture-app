# 領収書入力アプリ

音声入力、カメラ画像、OCR、AI整形を使って領収書データを作成し、CSVとして出力するTauriアプリです。

現在の実装は、MacとWindowsの両方で動作確認しやすいように、APIキーをOS固有のキーチェーンではなく環境変数またはアプリ設定から読み取ります。

## リポジトリ

```bash
git clone https://github.com/tak-thio/receipt-voice-capture-app.git
cd receipt-voice-capture-app
```

## 必要なもの

- Node.js
- npm
- Rust / Cargo
- Tauriのビルドに必要なOS別依存関係

Windowsでは、TauriのWindowsビルド要件として Microsoft Visual Studio Build Tools と WebView2 Runtime が必要です。詳しくはTauri公式のPrerequisitesを確認してください。

## セットアップ

```bash
npm install
```

## APIキー設定

OpenAIまたはGeminiを使う場合、次のどちらかでAPIキーを設定します。

1. アプリの「設定」画面で `OpenAI APIキー` または `Gemini APIキー` に入力して保存する
2. 環境変数として設定する

環境変数の例:

```bash
OPENAI_API_KEY=your-openai-api-key
GEMINI_API_KEY=your-gemini-api-key
```

環境変数が設定されている場合は環境変数を優先し、未設定の場合はアプリ設定に保存されたキーを使います。

注意: `settings.json` と `src-tauri/settings.json` はローカル設定ファイルとして `.gitignore` に入れています。実際のAPIキーはコミットしないでください。
Windowsでは、アプリ設定と既定の `receipt-sessions` は `%APPDATA%\com.tak.receiptvoicecapture\` 配下に保存されます。

## 開発起動

Tauriアプリとして起動:

```bash
npm run app:test
```

Windowsでテスターが起動する場合:

```powershell
scripts\windows-start.cmd
```

または:

```bash
npm run tauri dev
```

ブラウザだけでUIを確認する場合:

```bash
npm run dev
```

ただし、ブラウザ起動ではTauri側のファイル保存、OCR、STT、AI整形などのバックエンドコマンドは使えません。

## テストとビルド

TypeScriptの型チェック:

```bash
npm run typecheck
```

フロントエンドのテスト:

```bash
npm test
```

Rust側の確認:

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Web部分のビルド:

```bash
npm run build
```

Tauriアプリのビルド:

```bash
npm run tauri build
```

## ローカルSTTを使う場合

ローカルSTTはPython sidecar経由で `faster-whisper` を使います。通常のAI API利用だけなら必須ではありません。

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

アプリは `.venv-stt/bin/python` と `.venv-stt/Scripts/python.exe` の両方を探します。

## 基本的な使い方

1. `npm run app:test` でアプリを起動する
2. 設定画面でAIプロバイダー、APIキー、STT/OCRモードを設定する
3. 入力画面で録音またはテスト入力を行う
4. 必要に応じてカメラ画像を保存し、OCRで照合する
5. レビュー画面で日付、支払先、金額、勘定科目などを確認・修正する
6. エクスポート画面からCSVを出力する

## Gitでのコミット手順

作業前に状態を確認:

```bash
git status
git pull --rebase origin main
```

変更内容を確認:

```bash
git diff
```

テスト:

```bash
npm run typecheck
npm test
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

コミット:

```bash
git add README.md docs
git add package.json package-lock.json src src-tauri tests dictionaries
git commit -m "Describe the change"
```

GitHubへ反映:

```bash
git push origin main
```

注意:

- APIキー、録音ファイル、領収書画像、セッションデータはコミットしない
- `settings.json`、`src-tauri/settings.json`、`receipt-sessions/`、`.venv-stt/` はローカル専用
- Windowsで検証した場合は、失敗ログ、OS、Node/npm、Rustのバージョンを残す

Windows検証の詳細チェックリストは `docs/windows-checklist.md` を参照してください。

## Windowsで相手に確認してもらうとき

社内テスターにCodexでビルドと確認を依頼する場合は、テスト用ブランチ `test/windows-local-build` と `docs/tester-codex-instructions.md` を渡してください。
このブランチはWindowsローカルビルド確認用に固定し、開発中の変更を混ぜない運用にします。

相手には以下を依頼すると原因切り分けがしやすくなります。

```bash
node -v
npm -v
rustc --version
cargo --version
npm install
npm run typecheck
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run app:test
```

失敗した場合は、実行したコマンド、エラーログ全文、Windowsのバージョンを共有してもらってください。
