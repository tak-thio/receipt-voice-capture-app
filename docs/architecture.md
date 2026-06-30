# アーキテクチャ概要

税理士事務所向けの**マルチテナント領収書SaaS**。顧問先がスマホ(mobile)で領収書を撮影/入力し、
事務所がPC(web)で仕分け・確認・会計ソフト連携用にエクスポートする。

> 詳細設計は [`saas-design.md`](saas-design.md)、モバイルは [`mobile-checklist.md`](mobile-checklist.md) /
> [`handoff-mac-mobile.md`](handoff-mac-mobile.md) を参照。
>
> ⚠️ 旧版(デスクトップ単体・端末ローカルSTT/OCR前提)の設計は `docs/legacy/` に退避済み。本書が現行。

## 1. 全体像

```
┌── mobile/ (Tauri2: 顧問先の撮影/入力) ──┐        ┌── web/ (React SPA: 事務所のPC作業) ──┐
│  YOLO自動スキャナ + 音声メモ            │        │  受信箱 / 仕分け / 出力 / マスタ /     │
│  standalone(端末完結) / server-linked  │        │  顧問先 / 設定                          │
└──────────────┬──────────────────────────┘        └───────────────┬──────────────────────┘
               │ QRペアリング→端末トークン / 画像・音声アップロード │ セッションCookie
               ▼                                                    ▼
        ┌────────────────────── Caddy(単一オリジン: SPA + /api + TLS) ──────────────────────┐
        │                          api/ (FastAPI + SQLAlchemy)                              │
        │   テナント/認証/RBAC ・ /captures 受領 ・ 仕分け/学習 ・ CSV/元帳エクスポート       │
        └───────┬──────────────────────────────┬───────────────────────┬───────────────────┘
                ▼                               ▼                       ▼
        PostgreSQL(RLSでテナント分離)   オブジェクトストレージ      AIプロバイダ(全て外部API)
                                        (MinIO/S3: 画像/音声/PDF)   OpenAI / Gemini / Ollama / whisper
```

- **モノレポ**: `api/`(backend)・`web/`(SPA)・`mobile/`(撮影クライアント)・`docs/`。`docker-compose.yml` + `Caddyfile` で一式起動。
- **配信**: Caddy 単一オリジン(`/api/*`→FastAPI、それ以外→SPA。CORS回避・TLS終端)。`http://localhost:8088`。
- **永続化**: PostgreSQL(RLS) + オブジェクトストレージ(MinIO/S3互換)。

## 2. テナントモデルと認証

- 階層: **firm(事務所)→ client(顧問先)→ receipts / masters**。テナント系テーブルは必ず `firm_id`(+該当なら `client_id`)を持つ。
- **テナント分離は PostgreSQL の RLS で強制**(`api/alembic/0001`・`0007`)。アプリの WHERE 句に依存しない。実行ロールは非特権 `receipt_app`(`NOBYPASSRLS`)。
- 認証:
  - **Web**: メール+パスワードのセッションCookie。
  - **モバイル**: 事務所がWebで発行した**QRをスキャン→ペアリング**し、長期の**端末トークン**(`Authorization: Bearer`)を得る。顧問先はパスワード入力不要。

## 3. AI処理 — すべて外部APIで実行

> **重要: AIはサーバが動くマシン上でモデルを動かさない。STT/OCR/整形のすべてを外部APIエンドポイントへの呼び出しで行う。**

- プロバイダ抽象層 `api/app/ai/`(`factory.py` / `providers.py` / `base.py`)。事務所ごとに**能力(STT / OCR / 整形)単位でプロバイダを選択**(`firms.ai_config`)。

| 能力 | プロバイダ | 呼び出し先 |
|---|---|---|
| **STT**(音声→文字) | openai / gemini / whisper | 各社API / whisper は別サーバの `whisper_host/transcribe` |
| **OCR**(画像→文字) | ollama / openai / gemini | ollama は別サーバの `ollama_host`(qwen2.5vl)/ 各社API |
| **整形**(文字→構造化) | ollama / openai / gemini | 同上 |

- **キー**: OpenAI / Gemini は事務所ごとのキーを暗号化保存(`ai_config.*.key_enc`、Fernet)。**Ollama / whisper はキー不要**で、**接続先URL(`ollama_host` / `whisper_host`)を設定して別サーバのエンドポイントをAPI呼び出し**する(=自前モデルも「外部API」扱い。アプリ機上では動かさない)。
- **旧方式は廃止**: 端末で Tesseract CLI / faster-whisper サイドカーを直接起動する構成は撤去済み。モバイルは「撮影してアップロード(または端末からクラウドAPIを直接呼ぶ)」だけを行う。

## 4. データフロー

### 4.1 モバイル(撮影/入力)
1. カメラ起動 → **YOLO自動スキャナ**(`mobile/src/services/detection/`)が領収書を検出→自動シャッター→クロップ。任意で音声メモを録音。
2. **2モード**(設定で切替):
   - **standalone**: 端末内にセッション保存。AIは端末から**クラウドAPI(OpenAI/Gemini)を直接**呼ぶ(個人/小規模・各自キー)。
   - **server-linked**: 画像/音声/キャプチャメタを `POST /captures` へアップロード(`mobile/src/api/server-api.ts`)。AIはサーバが実行。

### 4.2 サーバ(仕分け/確認/出力)
1. `/captures`(`api/app/routers/captures.py`)が受領 → ストレージ保存 + `receipts` 作成 + **AIジョブ登録**。
2. ジョブワーカーが**選択プロバイダ(外部API)**で STT/OCR/整形 → `receipts` を更新。
3. 事務所が **web** で仕分け(勘定科目/補助科目/取引先/付箋を付与)。確定で**学習**(店名→科目ルール、取引先履歴)。
4. **エクスポート**: 会計ソフト向けCSV(汎用 / MJS-MAS / freee / 弥生)+ **元帳CSV**(科目別・小計/合計)。

## 5. 仕分け・学習・辞書

- 仕分け提案の優先順位(`api/app/journaling.py`): **店名→科目ルール > 取引先履歴 > 摘要辞書**。
- 摘要→勘定科目の辞書(`api/app/dictionaries.py`、例): 文具代→消耗品費 / 電車代・タクシー代・高速代→旅費交通費 / 飲食代→接待交際費・会議費 / 書籍代→新聞図書費 / 切手代→通信費 / 宅配便→荷造運賃 / 振込手数料→支払手数料。
- 照合(matching): **音声優先**。OCRは値を上書きせず、差異は警告材料として提示。

## 6. マスタ

- **勘定科目 / 補助科目**: 事務所テンプレート + 顧問先上書き。新規顧問先には標準チャート(約48科目)を顧問先データとして複製。
- **取引先 / 学習ルール / 付箋(ラベル)**: 顧問先単位。
- 付箋は「社長に確認」等のテキスト+色のラベルで、受信箱・仕分けで付与/参照。

## 7. ロール / 権限

- **職員**: `firm_owner`(管理者: 全顧問先・設定・職員管理) / `firm_staff`(一般社員: 担当顧問先のみ)。
- **利用者**: `client_admin`(自社の全データ+利用者管理) / `client_accountant`(自社の全データ閲覧) / `client_user`(自分が登録したデータのみ)。
- 表示(ナビ)も権限で制御し、変更系APIはロールでゲート。RLSで own/担当/テナント範囲を強制。

## 8. リポジトリ構成とブランチ

| パス | 中身 | 技術 |
|---|---|---|
| `api/` | マルチテナント backend | FastAPI + SQLAlchemy + Alembic + PostgreSQL(RLS) |
| `web/` | 事務所/利用者向け SPA | React + Vite + Tailwind |
| `mobile/` | 撮影クライアント | Tauri 2 + React + Rust |
| `docs/` | 設計ドキュメント(本書ほか) | — |

- ブランチ: **`developer`(統合基点)** → `feature/saas-backend`(サーバ) / `feature/mobile`(アプリ)。
- リモート(メイン): 会社 GitLab `git@git.itsherpa.net:itsherpa/ai/receipt-voice-capture-app.git`。

## 関連ドキュメント
- [`saas-design.md`](saas-design.md) — テナント/RLS/QR/AI/フェーズの詳細設計
- [`mobile-checklist.md`](mobile-checklist.md) — Android/iOS ビルド手順
- [`handoff-mac-mobile.md`](handoff-mac-mobile.md) — Mac/iOS 引き継ぎ
- `docs/legacy/` — 旧版(デスクトップ単体・端末ローカルAI前提)。歴史参照用。
