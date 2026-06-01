# 開発引き継ぎメモ

このメモは、MVPを提携システム開発会社へ引き継ぐための概要資料です。詳細な利用手順は `docs/manual.md`、Windowsでの検証手順は `docs/windows-checklist.md`、社内テスター向けCodex指示は `docs/tester-codex-instructions.md` を参照してください。

## 対象

- リポジトリ: https://github.com/tak-thio/receipt-voice-capture-app.git
- 引き継ぎ対象ブランチ: `test/windows-local-build`
- アプリ種別: Windowsローカル実行を主対象にした Tauri + React デスクトップアプリ
- MVPの目的: 音声入力、領収書画像、OCR、AI整形を組み合わせて領収書データを作成し、レビュー後にCSV出力する

## 実装済み機能

- Windowsでのローカルビルド、Tauri開発起動
- 設定画面からのGemini/OpenAI APIキー保存
- AIプロバイダー、STT、OCR、AI整形モードの設定
- カメラプレビューと領収書画像の保存
- マイク録音と録音ファイルの保存
- Gemini/OpenAIを使った文字起こし
- Gemini OCRまたは既存OCR経路による画像テキスト取得
- AI整形による領収書データ化
- レビュー画面での確認、手動修正、確定
- 支払方法、勘定科目、摘要マッピング辞書の確認
- 設定画面からの追加辞書登録、削除
- CSVプレビューとCSV保存
- Windows用開発起動スクリプト `scripts/windows-start.cmd` / `scripts/windows-start.ps1`

## 主要画面

- 入力画面: カメラ、録音、最新の撮影画像、最新の録音、AI整形、入力済みレコード確認
- レビュー画面: STT/OCR/AI整形結果の確認、修正、確定
- エクスポート画面: CSV形式選択、プレビュー、保存
- 設定画面: APIキー、AI/STT/OCR設定、診断、辞書確認・追加、セッション状態確認

## 技術構成

- フロントエンド: React, TypeScript, Vite
- デスクトップ基盤: Tauri v2
- バックエンド: Rust
- 状態管理: Zustand
- スキーマ検証: Zod
- AI連携: Gemini API / OpenAI API
- テスト: Vitest, Rust unit tests

## データ保存

Windowsでは、アプリ設定と既定のセッション保存先は次のアプリデータ配下に置かれます。

```powershell
%APPDATA%\com.tak.receiptvoicecapture\
```

主な保存対象:

- `settings.json`: アプリ設定、APIキー、追加辞書
- `receipt-sessions\`: セッション、レコード、撮影画像、録音ファイル

注意:

- APIキーはリポジトリへコミットしない運用です。
- 標準辞書JSONはリポジトリ内にありますが、画面から追加した辞書は標準JSONを直接変更せず、アプリ設定内の `customDictionaries` に保存します。
- 録音ファイル、領収書画像、セッションデータはローカル利用データとして扱います。

## 重要な設計判断

- MVP段階では、APIキーはOSキーチェーンではなく、アプリ設定または環境変数から読み取る実装です。
- Windowsの相対保存先は、作業ディレクトリではなくアプリデータ配下へ解決するようにしています。
- 社内テストではインストーラー配布ではなく、GitリポジトリをCodexでcloneしてローカルビルドする運用です。
- ローカルSTTのPython/faster-whisper経路は残していますが、社内テストの必須確認からは外しています。API経由のSTT確認を優先します。
- ローカルOCRのTesseract導入は必須ではありません。Gemini OCRを主な確認経路とします。
- 追加辞書は標準辞書より優先して読み込まれます。同じIDまたは同じ摘要マッピングキーの場合、追加辞書側を優先します。

## 確認済み項目

Windows環境で次を確認済みです。

- `npm install`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run app:test`
- `npm run tauri build`
- 設定画面からのAPIキー入力と接続確認
- 録音と文字起こし
- AI整形
- 辞書の確認・追加
- CSV保存

## 現在の未解決・未実装事項

- インストーラー形式の配布は未整備です。
- APIキーの保存方式はMVP向けです。本番運用ではOSキーチェーン、資格情報ストア、暗号化、権限設計の再検討が必要です。
- エラー表示、ログ出力、障害調査用ログ収集は最小限です。
- 社内テスト結果を踏まえたUI/UX改善は未反映の可能性があります。
- 業務上必要なCSV項目、会計ソフト連携仕様、勘定科目ルールは追加確認が必要です。
- OCR/STT/AI整形の精度評価、失敗時の再実行フロー、手動補正フローは本開発で強化が必要です。
- ローカルSTT、ローカルOCRの導入手順とサポート範囲は未確定です。
- セッションデータの長期保存、削除、バックアップ、個人情報管理の方針は未確定です。
- 複数PC利用、共有フォルダ利用、ネットワーク保存などの運用設計は未実装です。
- 自動更新、バージョン管理、配布後のアップデート方式は未実装です。
- 権限周り、カメラ/マイク利用許可、Windows Defenderや企業端末ポリシーでの制約確認は今後の検証対象です。
- 本番向けのセキュリティレビュー、利用規約/プライバシー観点の整理は未実施です。

## 引き継ぎ時に共有したい補足

開発会社には、対象ブランチをビルドしてコードと動作を確認してもらったうえで、MVPを本開発へ進める際の配布方式、資格情報管理、データ保存、CSV連携仕様、AI利用方針、ログ/監査設計について技術判断を依頼する想定です。

