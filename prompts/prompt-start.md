# Codex Start Prompt

添付した requirements.md / architecture.md / tasks.md / open-questions.md を読んで、このアプリのMVP実装を開始してください。

進め方のルール:
- まずは requirements と architecture の内容を要約し、実装方針を確認する
- その後、Phase 0 と Phase 1 から着手する
- 最初は STT/OCR を本接続せず、adapter interface とダミーデータで end-to-end を通す
- データモデル、保存構造、画面骨組みを先に固める
- Capture画面は「左カメラ / 右最新画像 / 下一覧表」のレイアウトを優先する
- Review/Edit画面は「表編集モード」と「詳細確認モード」の両方を作る前提で設計する
- 変更や判断が必要な点は、実装前に `docs/open-questions.md` に整理する
- 実装を進めながら `docs/tasks.md` を更新し、完了済み項目が分かるようにする
- 辞書ファイルは `dictionaries/` 配下の JSON を読み込む前提で実装する

最初のアウトプットとして以下を出してください:
1. 実装方針の要約
2. 推奨ディレクトリ構成
3. Phase 0/1 の着手計画
4. 最初に作る型定義とファイル一覧
5. 現時点の open questions と、その暫定解決方針
