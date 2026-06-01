# 新規Codexプロジェクト用プロンプト

社内テスターが新規Codexプロジェクトを作るときは、以下を貼り付けてください。

```text
Windows PCで、以下のGitHubリポジトリとブランチをclone/checkoutし、ローカルビルドして社内テスト用に起動してください。

リポジトリ:
https://github.com/tak-thio/receipt-voice-capture-app.git

ブランチ:
test/windows-local-build

作業方針:
- 可能なら C:\dev\receipt-voice-capture-app にcloneしてください。
- README.md、docs/manual.md、docs/windows-checklist.md、docs/tester-codex-instructions.md を読んでから進めてください。
- APIキーはCodexに貼りません。アプリ起動後、私が設定画面で入力します。
- 実APIキー、録音ファイル、領収書画像、CSV、セッションデータをGitやチャットログに残さないでください。
- ローカルSTT用のPython/faster-whisperやTesseractなど、不要な追加インストールは避けてください。まずGeminiまたはOpenAI API経由で確認してください。

最低限実行してほしいこと:
1. node -v / npm -v / rustc --version / cargo --version を確認する
2. npm install を実行する
3. npm run typecheck を実行する
4. scripts\windows-start.cmd でアプリを起動する
5. 起動後は、私が設定画面でAPIキーを入力してから、録音、文字起こし/AI整形、レビュー修正、辞書追加、CSV出力を確認する

最後に、成功した項目、失敗した項目、実行したコマンド、エラーがあれば全文を報告してください。
```
