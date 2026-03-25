# Receipt Voice Capture App - Initial Tasks

## Phase 0: Project Setup
- [x] Tauri + React プロジェクトを初期化
- [x] 基本レイアウトとルーティングを作成
- [x] 型定義と共通モデルを作成
- [x] ローカル保存先の設計を実装
- [x] 設定ファイルの読み書きを実装

## Phase 1: UI Skeleton
- [x] Capture画面を作成
- [x] Review/Edit画面を作成
- [x] Export画面を作成
- [x] Settings画面を作成
- [x] 共通ナビゲーションを実装

## Phase 2: Session / Record Model
- [x] Session型を定義
- [x] Record型を定義
- [x] session.json の保存/読込を実装
- [x] レコード追加・更新・削除を実装
- [x] 画像パス紐付けを実装

## Phase 3: Capture Flow
- [x] カメラプレビューを表示
- [x] カメラ / マイク選択 UI を実装
- [x] 「次 / 次へ」時の画像保存処理を実装
- [x] 最新キャプチャ画像を右ペインに表示
- [x] 下部一覧表に新規行追加できるようにする
- [x] 一覧表から行選択できるようにする

## Phase 4: STT Integration
- [x] faster-whisper の実行方式を決める
- [x] 音声録音機能を実装
- [x] 録音データを session 配下へ保存できるようにする
- [x] 音声セグメントを取得できるようにする
- [x] 「次 / 次へ」検出を実装
- [x] STT結果をレコード候補として保持する
- [x] backend 側の STT command / service scaffold を実装

## Phase 5: Rule-Based Parser
- [x] 日付パーサを実装
- [x] 金額パーサを実装
- [x] 税区分パーサを実装
- [x] 支払方法パーサを実装
- [x] 区切り語除去を実装
- [x] description_raw / account_category_final の初期割当ロジックを実装
- [x] パース失敗時の warning 付与を実装

## Phase 6: OCR Integration
- [x] OCRアダプタの抽象インターフェースを作る
- [ ] 画像からOCRテキストを取得する処理を実装
- [x] 日付・金額・支払先・インボイス番号候補抽出を実装
- [x] OCR結果をレコードに保持する

## Phase 7: Matching / Review
- [x] STT vs OCR の一致判定ロジックを実装
- [x] `ok / warning / review_required` を計算
- [x] mismatch reasons を保存
- [x] 一覧表に状態列を表示
- [x] 詳細モードで画像 / STT / OCR を並べて表示
- [x] 手動修正を final 値へ反映

## Phase 8: Dictionaries
- [x] 支払方法辞書JSONを作成
- [x] 勘定項目辞書JSONを作成
- [x] 但書→勘定項目マッピング辞書JSONを作成
- [x] 設定画面から辞書を読み込めるようにする

## Phase 9: Export
- [x] 共通内部モデルからCSV生成を実装
- [x] freeeフォーマッタを実装
- [x] 弥生フォーマッタを実装
- [x] 汎用CSVフォーマッタを実装
- [x] 出力前プレビューを実装
- [x] 保存ダイアログを実装

## Phase 10: QA / Hardening
- [x] 代表的な音声例でパーステストを作成
- [x] OCRなし時の動作確認
- [x] 画像未保存時のエラー処理
- [x] backend 側で current session を復元できるようにする
- [x] 現在セッションの再読込 UI を追加する
- [x] 保存済みセッション一覧と復元 UI を追加する
- [ ] セッション途中終了からの復帰確認
- [ ] Windows優先で動作確認
- [ ] macOSの基本確認

## Nice to Have (Post-MVP)
- [ ] 前後複数フレーム保存
- [ ] 自動トリミング
- [ ] 店名正規化辞書
- [ ] 勘定項目推定精度向上
- [ ] SQLite移行
- [ ] 一括再OCR / 再判定
