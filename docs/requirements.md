# Receipt Voice Capture App - Requirements

## 1. Overview
手書き領収書をカメラで撮影しながら、ユーザーが必要情報を音声で読み上げ、領収書ごとの情報を表形式で蓄積・修正し、会計ソフト向けCSVとして出力できるデスクトップアプリを作る。

主入力は音声認識（STT）とし、OCRは照合・補完用途で使う。

## 2. Target Platform
- MVP優先: Windows
- 次点対応: macOS
- アプリ形態: Tauriデスクトップアプリ
- UI: React
- ローカル完結を基本とする

## 3. Core User Flow
1. ユーザーが取り込みセッションを開始する
2. 領収書をカメラに映しながら内容を読み上げる
3. 「次」または「次へ」と発話する
4. そのタイミングで:
   - 現在の1件を確定
   - 画像キャプチャを保存
   - 基準時刻を記録
5. STT結果をパースして一覧表に1行追加する
6. OCR結果と照合し、信頼度を判定する
7. ユーザーが一覧または詳細画面で修正する
8. freee / 弥生 / 汎用CSVとして出力する

## 4. Input Specification

### 4.1 Speech Input Style
- 基本は自然な順読み
- 項目名の明示は必須ではない
- 推奨読み上げ順は固定
- 順番の揺れは一部許容するが、MVPはルールベースで固定順を優先する

### 4.2 Recommended Speech Order
1. 日付
2. 支払先
3. 税区分（税込 / 税抜）
4. 金額
5. 支払方法
6. 但書 or 勘定項目
7. 摘要
8. インボイス番号
9. 区切り語（次 / 次へ）

### 4.3 Example Utterances
- 3月24日 セブンイレブン 税込1158円 現金 文具代 次へ
- 3月25日 ロイヤルホスト 税込2320円 現金 飲食代 接待費 次へ
- 3月25日 タイムズ博多 400円 現金 駐車場代 交通費 次へ

### 4.4 Segment Boundary Keywords
- 次
- 次へ

役割:
- 1レコード確定
- 画像キャプチャ確定
- 基準時刻の確定

## 5. Data Fields

### 5.1 Required Final Fields
- 日付
- 支払先
- 税区分
- 金額
- 支払方法
- 但書
- 勘定項目
- 摘要
- インボイス番号
- メモ

### 5.2 Supporting Fields
- 参照画像リンク
- STT抽出テキスト
- OCR抽出テキスト
- OCR候補
- 一致判定ステータス
- 要確認フラグ
- キャプチャ時刻
- セグメント開始/終了時刻

## 6. Field Rules

### 6.1 Date
- 保存形式: YYYY-MM-DD
- 年が省略された場合は現在年を補完
- 年が明示された場合は明示値を優先

### 6.2 Vendor
- 音声入力を原則優先
- OCRは照合用
- 店名正規化はMVPでは行わない

### 6.3 Tax Mode
- 税込 / 税抜 を想定
- MVPではこの2値を主要対象とする
- 将来的に非課税等を拡張可能な設計にする

### 6.4 Amount
- 数値で保存する
- 音声入力を原則優先
- 税区分とセットで読み上げられる想定

### 6.5 Payment Method
- 初期候補:
  - 現金
  - クレジットカード
  - 電子マネー
- 内部的には自由入力も許可する

### 6.6 Description / Account Category
- 但書と勘定項目は分離する
- 読み上げられた内容を `description_raw` に保持
- 勘定項目は `account_category_final` に保持
- 明示的な勘定項目がない場合、但書から候補推定する

### 6.7 Summary
- 任意
- 未入力時は空欄保存

### 6.8 Invoice Number
- 任意
- 未入力時は空欄保存

### 6.9 Memo
- 自由文入力

## 7. OCR Role
- 主入力ではなく、照合・補完用
- MVPで重視する抽出対象:
  - 日付
  - 金額
  - 支払先
  - インボイス番号

## 8. Matching Rules

### 8.1 Priority
音声入力を原則優先して保存する。

### 8.2 Match Levels
- ok
- warning
- review_required

### 8.3 Policy
- 1項目程度のズレなら一致寄り判定を許容
- ただし以下は重要項目として強く扱う:
  - 金額
  - 支払先
  - 日付

### 8.4 Mismatch Handling
- 金額不一致: review_required
- 日付不一致: warning 以上
- 支払先大きく不一致: review_required
- OCR未抽出: warning

## 9. Image Handling
- 元動画は保存しない
- 「次 / 次へ」のタイミングで1枚保存
- MVPでは1枚保存を基本とする
- 将来的に前後フレーム保存や自動切り抜きを拡張可能にする

## 10. Screens

### 10.1 Capture Screen
- 左: カメラ映像
- 右: 最新キャプチャ画像
- 下: 追加済み一覧表

### 10.2 Review/Edit Screen
- 表編集モード
- 詳細確認モード
- 両方を切り替え可能にする

### 10.3 Export Screen
- 出力形式選択
- 件数確認
- 出力前プレビュー
- CSV保存

### 10.4 Settings Screen
- 保存先
- カメラ選択
- 音声入力デバイス選択
- STTモデル設定
- OCR有効/無効
- 支払方法辞書
- 勘定項目辞書
- CSV出力既定設定

## 11. CSV Export Targets
- freee
- 弥生
- 汎用CSV

## 12. Parsing Strategy
- MVPはルールベース
- 正規表現 + 固定順パース
- 不足項目は空欄
- 想定外構文は warning 扱い

## 13. Non-Goals for MVP
- 高精度な自動トリミング
- 動画全体保存
- 高度な店名揺れ正規化
- 高精度な完全自動勘定項目分類
- 複数フレームの高度な最適選択
