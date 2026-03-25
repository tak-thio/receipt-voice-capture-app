# Receipt Voice Capture Starter

Codexで着手するための初期設計・辞書・開始プロンプト一式。

## 構成
- `docs/requirements.md`
- `docs/architecture.md`
- `docs/tasks.md`
- `docs/open-questions.md`
- `docs/sample-utterances.md`
- `dictionaries/account-categories.json`
- `dictionaries/description-mapping.json`
- `dictionaries/payment-methods.json`
- `prompts/prompt-start.md`

## 推奨の開始手順
1. 新しい実装用プロジェクトフォルダを作る
2. このスターターフォルダの内容をその中に配置する
3. Codexに `prompts/prompt-start.md` の内容を渡す
4. まずは docs を読ませて方針要約と初期着手計画を出させる
5. 実装開始後は `docs/tasks.md` と `docs/open-questions.md` を更新させる

## 備考
- MVPでは STT/OCR を本接続せず、adapter + mock から開始する想定
- 但書と勘定項目は分離する
- 音声優先、OCRは照合用
