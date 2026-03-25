# Receipt Voice Capture App - Architecture

## 1. High-Level Architecture

### Frontend
- Tauri + React
- 画面:
  - Capture
  - Review/Edit
  - Export
  - Settings

### Backend / Local Processing
- Tauri backend
- ローカルファイル保存
- セッション管理
- 画像キャプチャ保存
- CSV出力

### STT Engine
- faster-whisper を第一候補
- ローカル音声ファイルまたは録音バッファを処理
- セグメントごとのテキストを取得
- 「次 / 次へ」でレコードを区切る

### OCR Engine
- 別モジュールとして分離
- 画像から候補テキストを抽出
- MVPでは照合専用

## 2. Directory Concept

- session/
  - session.json
  - audio/
  - captures/
  - exports/
  - logs/

例:
- captures/rec-0001.jpg
- exports/freee_2026-03-25.csv

## 3. Data Model

### 3.1 Session
1回の取り込み作業全体を表す。

Fields:
- id
- created_at
- updated_at
- settings_snapshot
- records[]

### 3.2 Record
領収書1件分の単位。

Fields:
- id
- captured_at
- image_path

#### stt
- raw_text
- parsed_fields
- segment_start_ms
- segment_end_ms

#### ocr
- raw_text
- extracted_candidates

#### final
- date
- vendor
- tax_mode
- amount
- payment_method
- description_raw
- account_category_final
- summary
- invoice_number
- memo

#### review
- match_status
- review_required
- mismatch_reasons[]

### 3.3 Export Profile
- freee
- yayoi
- generic

## 4. State Flow

### 4.1 Capture Flow
1. セッション開始
2. カメラプレビュー開始
3. 音声入力開始
4. STTセグメント蓄積
5. 区切り語検出
6. 画像キャプチャ保存
7. STTパース
8. OCR実行
9. 照合判定
10. レコード追加

### 4.2 Review Flow
1. レコード一覧表示
2. 行単位編集
3. 詳細モードで画像確認
4. 不一致理由確認
5. 値修正
6. 再判定または手動確定

### 4.3 Export Flow
1. 出力形式選択
2. 変換バリデーション
3. CSV生成
4. 保存

## 5. Parsing Design

### 5.1 Input Assumption
MVPでは以下順を基本とする:
- 日付
- 支払先
- 税区分
- 金額
- 支払方法
- 但書 or 勘定項目
- 摘要
- インボイス番号

### 5.2 Rule-Based Parsing
- 日付正規表現
- 金額正規表現
- 税区分キーワード検出
- 支払方法辞書照合
- 末尾の「次 / 次へ」を区切りとして除去
- 残りトークンを vendor / description / account / summary / invoice に割り当て

### 5.3 Fallback
- パースできない項目は空欄
- mismatch_reasons に記録
- review_required を true にする

## 6. Matching Engine Design

### 6.1 Weighted Fields
重要度:
1. amount
2. vendor
3. date
4. tax_mode
5. invoice_number
6. others

### 6.2 Output
- match_status
- confidence score (内部用)
- mismatch reasons

### 6.3 Principles
- 音声優先
- OCRは上書きしない
- OCR差異は警告材料

## 7. Dictionary Design

### 7.1 Payment Method Dictionary
- cash
- credit_card
- e_money
- custom

### 7.2 Account Category Dictionary
初期辞書はJSON化し編集可能にする。

### 7.3 Description Mapping Dictionary
- 文具代 -> 消耗品費
- 駐車場代 -> 旅費交通費
- 高速代 -> 旅費交通費
- 電車代 -> 旅費交通費
- タクシー代 -> 旅費交通費
- 飲食代 -> 接待交際費 / 会議費
- 書籍代 -> 新聞図書費
- 切手代 -> 通信費
- 宅配便 -> 荷造運賃
- サーバー代 -> ソフトウェア利用料
- 振込手数料 -> 支払手数料

## 8. Suggested Modules

- `capture/`
  - camera service
  - image capture service

- `audio/`
  - recording service
  - stt adapter
  - segment manager

- `ocr/`
  - ocr adapter
  - candidate extractor

- `parser/`
  - speech parser
  - date parser
  - amount parser
  - payment method parser

- `matching/`
  - scorer
  - mismatch classifier

- `records/`
  - session repository
  - record repository

- `export/`
  - freee formatter
  - yayoi formatter
  - generic formatter

- `settings/`
  - config loader
  - dictionary loader

## 9. Persistence Strategy
- セッション単位でJSON保存
- レコードは session.json にまとめる
- 画像はファイル保存
- CSVは export 時に生成
- 将来的にSQLite移行可能な抽象化を意識する

## 10. MVP Technical Priorities
1. 安定したレコード追加
2. ローカル保存の一貫性
3. 修正しやすい一覧UI
4. CSV出力の正確性
5. STT/OCRの差異可視化
