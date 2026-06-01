# 領収書入力アプリ

音声入力、カメラ画像、OCR、AI整形を使って領収書データを作成し、CSVとして出力するTauriアプリです。

社内テストでは、Windows PC上でCodexにこのリポジトリをclone/checkoutさせ、ローカルビルドして動作確認する想定です。

## 最短の起動・テスト導線

Windowsでテスターが確認する場合は、テスト用ブランチを使ってください。

```powershell
git clone https://github.com/tak-thio/receipt-voice-capture-app.git
cd receipt-voice-capture-app
git checkout test/windows-local-build
npm install
npm run typecheck
scripts\windows-start.cmd
```

`scripts\windows-start.cmd` はWindows用の開発起動ランチャーです。うまく起動しない場合は、次も試してください。

```powershell
npm run app:test
```

## APIキーの扱い

GeminiまたはOpenAIのAPIキーは、アプリ起動後に設定画面から入力してください。

実APIキーをREADME、docs、Git、Codexのチャット、設定例、スクリーンショットに残さないでください。ローカル設定ファイルや録音・画像・セッションデータもコミット対象外です。

## ドキュメント

- [社内テスター/初回利用者向けマニュアル](docs/manual.md)
- [Windows動作確認チェックリスト](docs/windows-checklist.md)
- [テスター向けCodex指示文](docs/tester-codex-instructions.md)
- [新規Codexプロジェクト用の短いプロンプト](docs/codex-tester-prompt.md)

## 開発者向けコマンド

```powershell
npm run typecheck
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Windows検証で失敗した場合は、実行したコマンド、エラー全文、Windowsのバージョン、`node -v`、`npm -v`、`rustc --version`、`cargo --version` を共有してください。
