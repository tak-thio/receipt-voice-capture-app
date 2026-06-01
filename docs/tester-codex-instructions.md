# テスター向け Codex 指示文

このドキュメントは、社内テスターが各自のWindows PCでCodexに依頼して、リポジトリからアプリをビルドし、音声入力から文字起こし、AI整形、CSV保存まで確認するための指示文です。

新規Codexプロジェクトに貼る短い依頼文だけが必要な場合は、`docs/codex-tester-prompt.md` を使ってください。アプリの操作手順は `docs/manual.md` にまとめています。

## テスターに渡す情報

- GitHubリポジトリ: https://github.com/tak-thio/receipt-voice-capture-app.git
- テスト用ブランチ: `test/windows-local-build`
- 推奨clone先: `C:\dev\receipt-voice-capture-app`
- APIキー: アプリ起動後に設定画面へ入力してください。Codexへのチャット、Git、README、設定例には貼らないでください。

## Codexに貼る指示文

以下をそのままCodexに貼ってください。

```text
Windows PCでこのリポジトリのテスト用ブランチをビルドして、アプリの動作確認をしてください。

リポジトリ:
https://github.com/tak-thio/receipt-voice-capture-app.git

ブランチ:
test/windows-local-build

作業方針:
- clone先は可能なら C:\dev\receipt-voice-capture-app にしてください。
- APIキーはアプリの設定画面から私が入力します。実キーをファイル、Git、チャットログに残さないでください。
- ローカルSTT用のPython/faster-whisperやTesseractなど、不要な追加インストールは避けてください。GeminiまたはOpenAI API経由の確認を優先してください。
- README.md、docs/manual.md、docs/windows-checklist.md、docs/tester-codex-instructions.md を読んでから進めてください。
- Windows固有のエラーが出たら、原因を特定して修正し、再実行してください。

実行してほしい確認:
1. 前提ツールを確認してください。
   - node -v
   - npm -v
   - rustc --version
   - cargo --version
2. リポジトリをcloneして、test/windows-local-build を checkout してください。
3. npm install を実行してください。
4. 次のチェックを順に実行してください。
   - npm run typecheck
   - npm test
   - npm run build
   - cargo check --manifest-path src-tauri/Cargo.toml
   - cargo test --manifest-path src-tauri/Cargo.toml
5. アプリを起動してください。
   - scripts\windows-start.cmd
   - うまくいかない場合は npm run app:test
6. アプリ起動後、私が設定画面でAPIキーを入力します。
7. 設定画面でAIプロバイダー、STT、OCR、AI整形がGeminiまたはOpenAIを使う設定になっているか確認してください。
8. 入力画面でカメラとマイクの許可を確認し、録音、文字起こし、AI整形、レビュー画面での確認、CSV保存まで試してください。
9. 辞書の確認・追加機能で、勘定科目または摘要マッピングを1件追加できるか確認してください。

失敗した場合に残してほしい情報:
- 実行したコマンド
- エラー全文
- node -v / npm -v / rustc --version / cargo --version
- Windowsのバージョン
- clone先のパス
- アプリ画面上のエラーメッセージ

最後に、成功した確認項目、失敗した確認項目、修正したファイルがあればその一覧を報告してください。
```

## テスター本人がアプリ内で確認する項目

- 設定画面を開ける
- GeminiまたはOpenAI APIキーを保存できる
- AI診断または接続チェックで選択中プロバイダーが利用可能になる
- 入力画面でカメラプレビューが表示される
- 録音開始、録音停止ができる
- 最新の撮影画像と最新の録音が表示される
- `AI整形` ボタンで録音または入力内容からレコードを作れる
- レビュー画面でレコードを確認、必要なら修正できる
- 設定画面の辞書の確認・追加で項目を追加、削除できる
- エクスポート画面でCSV保存ダイアログが開き、任意のフォルダに保存できる

## 依存関係を増やさないための注意

- 今回のテストではローカルSTTの `.venv-stt` 作成と `scripts\requirements-stt.txt` のインストールは不要です。
- TesseractなどのローカルOCR導入も必須ではありません。Gemini OCRまたは既存設定で確認してください。
- インストーラー作成は不要です。Tauri開発起動または `scripts\windows-start.cmd` を使ってください。
- APIキー、録音ファイル、領収書画像、セッションデータはローカル専用です。コミットしないでください。

