# 領収書SaaS 設計ドキュメント(マルチテナント / 税理士事務所向け)

> ステータス: ドラフト(レビュー用) — 2026-06-05
> このドキュメントは **新規のマルチテナント backend リポジトリ**(仮称 `receipt-saas`)を前提に書いています。
> 既存の `~/dev/receipt-app` は **参照実装(社内プロトタイプ)** として温存し、本体はいじりません。

---

## 1. 背景と目的

複数の **税理士事務所** に提供する SaaS。各事務所の **顧問先(クライアント企業)** が領収書を入力し、事務所が確認・仕分け・会計ソフト連携用に出力する。

- **入力はスマホが便利**(顧問先が外出先で撮影・音声入力)
- **仕分け・確認はPCがやりやすい**(事務所職員・顧問先事務員が大画面で)
- **AIコストは事務所が負担**(事務所ごとのAIキーをサーバ保管、AIはサーバ側で実行)

### 既存資産の位置づけ
| 資産 | 役割 | 扱い |
|---|---|---|
| `receipt-app`(FastAPI+PG+React) | 仕分けエンジン・マスタ・取込・突合・全文検索の**実証済みロジック** | **参照実装**。ロジックを新backendへ移植 |
| `receipt-voice-capture-app`(Tauri) | スマホ撮影/録音・STT/OCR・**CSV整形(freee/弥生/MJS)** | **入力クライアント**として継続。保存をAPI化、AIはサーバへ移設 |

---

## 2. 全体アーキテクチャ

```
            ┌──────────────────────────── PC(ブラウザ / Web SPA)────────────────────────┐
            │  事務所職員: 担当顧問先を横断で確認・仕分け・確定・CSV出力                   │
            │  顧問先事務員: 自社分の確認・補正                                           │
            └───────────────▲───────────────────────────────────────────────────────────┘
                            │ HTTPS(セッション/トークン)
[顧問先スマホ(Tauri)]      │
  撮影/録音 → 生データ送信  │            ┌──────────────────────────────────────────────┐
  (QRでペアリング認証) ─────┼──────────▶ │  Backend(FastAPI + PostgreSQL)               │
                            │            │  ① 認証/テナント(firm→client, RLS)          │
                            │            │  ② AI: STT/OCR/整形(事務所キーで実行)       │
                            │            │  ③ 仕分けエンジン(receipt-appから移植)       │
                            │            │  ④ マスタ/突合/全文検索 / CSVエクスポート      │
                            │            └───────────────┬──────────────┬───────────────┘
                            │                            │              │
                            │                   ┌────────▼───┐   ┌──────▼───────────┐
                            │                   │ PostgreSQL │   │ オブジェクトストレージ │
                            │                   │ (RLS)      │   │ 画像/音声/PDF        │
                            │                   └────────────┘   └──────────────────┘
                            │                            ▲
                            │                   ┌────────┴───────┐
                            └───────────────────│ 外部AI(OpenAI/ │  ※事務所ごとのキー
                                                │ Gemini)        │
                                                └────────────────┘
```

ポイント:
- **AIキーは端末に置かない**。スマホは生データ(画像/音声)を送るだけ。サーバが事務所キーでAI実行。
- **データ分離はDBのRLS**で強制(アプリのWHERE漏れに依存しない)。

---

## 3. テナントモデル

2階層テナント: **事務所(firm) → 顧問先(client)**。ユーザーは membership で役割付き。

```
firm(税理士事務所)            ── AIキー保有・最上位テナント
 ├─ membership(role=firm_owner / firm_staff)  … client_id=NULL ⇒ 事務所配下の全顧問先を閲覧
 └─ client(顧問先)
      ├─ membership(role=client_admin / client_user) … client_id 指定 ⇒ 自顧問先のみ
      ├─ masters(勘定科目/補助科目/取引先/仕分けルール)  … client単位(事務所テンプレから複製)
      └─ receipts / files
```

### ロール
| role | 範囲 | 主な操作 | 端末 |
|---|---|---|---|
| `firm_owner` | 事務所全体 | 顧問先・職員・AIキー・課金管理 | PC |
| `firm_staff` | 担当 or 全顧問先 | 横断で確認・仕分け・確定・出力 | PC |
| `client_admin` | 自顧問先 | 顧問先内ユーザー管理・確認 | PC/スマホ |
| `client_user` | 自顧問先 | 領収書入力(撮影/録音)・自社分確認 | スマホ中心 |

> マスタ(勘定科目/取引先/学習ルール)は **顧問先単位**(各社の会計帳簿は別)。新規顧問先は事務所テンプレから複製して開始。

---

## 4. データモデル(ER 概要)

receipt-app の構造を踏襲しつつ、全テーブルに **テナントキー(firm_id / client_id)** を最初から付与。

```
firms(id, name, ai_config(jsonb), created_at, plan, status)
  -- ai_config = { stt:{provider,key_enc?}, ocr:{provider,key_enc?}, format:{provider,key_enc?} }
  --   provider ∈ openai | gemini | ollama | whisper(self-host)。自前(ollama/whisper)はkey不要
users(id, email, name, created_at)                       -- グローバル ID
memberships(id, user_id, firm_id, client_id?, role)      -- client_id NULL=事務所レベル
clients(id, firm_id, name, code, export_default, status)

pairing_tokens(id, firm_id, client_id, user_id, token_hash, expires_at, used_at)
device_sessions(id, user_id, client_id, refresh_token_hash, created_at, revoked_at)

files(id, firm_id, client_id, sha256, kind[image|audio|pdf], path, size, mime, uploaded_by)

receipts(
  id, firm_id, client_id, source[mobile|gmail|card|manual],
  captured_at, vendor, amount_jpy, tax_mode, payment_method, t_number,
  account_title_id?, sub_account_id?, partner_id?,
  stt_raw?, ocr_raw?, approval_status, journalized_at?, journal_hold,
  match_id?, search_text(生成列), created_by, created_at
)
receipt_files(receipt_id, file_id, kind[capture|audio|attachment])

-- マスタ
-- 勘定科目/補助科目: 事務所テンプレ(client_id NULL)＋顧問先上書き(client_id 指定)。code 一致で上書き、無ければ追加。
--   override_of(任意): テンプレ行を顧問先で隠す/差し替える参照。effective = テンプレ − 上書き対象 ＋ 顧問先行
account_titles(id, firm_id, client_id?, code, name, sort_order, active, override_of?)
sub_accounts(id, firm_id, client_id?, account_title_id, code, name, sort_order, active, override_of?)
-- 取引先/学習: 顧問先単位(各社で異なる・学習も顧問先ごと)
partners(id, firm_id, client_id, code, name, domain, active)
partner_aliases(id, client_id, raw_vendor, partner_id)
journal_rules(id, client_id, from_addr?, subject_keyword?, account_title_id, sub_account_id?, partner_id?, hit_count)

jobs(id, firm_id, client_id, kind[stt|ocr|card_ocr|gmail_ingest], status, params, progress, result, error)
audit_logs(id, firm_id, client_id?, actor_user_id, action, target, at)   -- Phase 3
```

主な差分(receipt-app比):
- 全テーブルに `firm_id` / `client_id`。
- **勘定科目/補助科目=事務所テンプレ＋顧問先上書き**、**取引先/学習=顧問先単位**。
- `source` に `mobile`。`stt_raw`/`audio` を追加(音声入力)。
- 認証系に `pairing_tokens` / `device_sessions`(QRペアリング)。
- `firms.ai_config` で **能力ごとにAIプロバイダ選択**(下記 §7)。

---

## 5. データ分離(RLS)

PostgreSQL の **Row Level Security** で強制。接続時に `SET app.current_user_id` / セッション変数を流し、ポリシーで判定:

- `firm_staff/owner`(membership.client_id IS NULL): 同 `firm_id` の行すべてアクセス可
- `client_user/admin`: 自分の `client_id` の行のみ
- 書き込みも同ポリシー(`USING` + `WITH CHECK`)

> アプリ層の WHERE に依存せず、**DBが最終防衛線**。会計データの事務所間漏洩を構造的に防ぐ。

> ⚠️ **重要(検証で判明)**: PostgreSQL の **superuser は RLS を完全にバイパス**する(FORCE指定でも)。
> postgres の既定ユーザー(`POSTGRES_USER`)は superuser なので、**アプリの実行時接続は専用の
> 非superuser・NOBYPASSRLS ロール**(例 `receipt_app`)で行う。マイグレーションのみ所有者ロールで実行。
> (実装: alembic `0002_app_role`、`APP_DATABASE_URL`)

---

## 6. 認証

### Web(PC)
- 事務所職員・顧問先事務員: メール+パスワード(or マジックリンク)。将来 Google/Workspace SSO(事務所ごと)。
- セッション(HttpOnly Cookie)。

### モバイル(顧問先): QRペアリング
```
1. PCで対象 client_user の「ペアリングQR」発行
   → サーバが pairing_token(短TTL・1回限り)を生成しQR化
2. アプリでQRスキャン → POST /pair { token }
   → サーバ検証 → device_session 発行(長期リフレッシュ + 短期アクセストークン)
3. 以後アプリは client_user として認証(パスワード入力なし)
   失効はPCから(device_sessions.revoked_at)
```
顧問先(非エンジニア)が**パスワードを打たずに**端末を紐付けられる。

---

## 7. AI処理(サーバ側・プロバイダ選択式)

**事務所ごとに、能力単位でプロバイダを選択**できる(`firms.ai_config`)。自前(Ollama/whisper)と外部API(OpenAI/Gemini)を混在可。

| 能力 | 選べるプロバイダ | 備考 |
|---|---|---|
| **STT**(音声→文字) | openai / gemini / **whisper(自前:faster-whisper)** | Ollama(qwen2.5vl)は音声非対応。自前なら faster-whisper を VM 常駐(元モバイルのsidecarをサーバ化) |
| **OCR**(画像→文字) | **ollama(qwen2.5vl)** / openai / gemini | 自前Ollamaは外部課金なし(receipt-app 流用) |
| **整形**(文字→構造化) | **ollama(qwen2.5)** / openai / gemini | |

- サーバに **プロバイダ抽象層**(`stt/ocr/format` の各アダプタ)。receipt-app の Ollama 直結を一般化し、プロバイダを差し替え可能に。
- **キー**: 外部(openai/gemini)は事務所ごと `ai_config.*.key_enc`(暗号化)。**自前(ollama/whisper)は外部キー不要**(コスト=自社VMの計算資源)。
- フロー: スマホ → 生データ(画像/音声)→ サーバが選択プロバイダで **STT/OCR/整形** → `receipts` 作成。モバイル側の端末内AIは撤去し「アップロードのみ」に。

> コスト帰属: 外部API=事務所キーで事務所負担 / 自前=自社VM。使用量メータリングは Phase 3。

---

## 8. 入力フロー(モバイル → サーバ)

`source` 違いの取込口の1つとして mobile を追加(receipt-app の設計思想を継承)。

```
[スマホ] 撮影+録音 → POST /captures (multipart: 画像, 音声, メタ)
      → サーバ: jobs(stt/ocr) → 整形 → receipts(source="mobile", client_id)
      → 仕分けエンジンが提案 → PCで確認・確定
```
- オフライン対策: 端末に未送信キューを保持し、回線復帰で再送(Phase 2)。

---

## 9. 仕分け・マスタ(receipt-app から移植)

- `journal.py` のロジック(`from_addr`+件名キーワードのルール学習、取引先ドメイン照合、`partner_aliases` 学習)を **client_id スコープで移植**。
- モバイル発のレコードは `from_addr` が無いので、**取引先は店舗名/OCR文字列ベースのマッチ**に拡張(vendor↔partners.name、エイリアス学習)。
- マスタCRUD(勘定科目/補助科目/取引先)を顧問先単位で。新規顧問先は事務所テンプレを複製。

---

## 10. エクスポート(モバイルから移植)

- receipt-app は **CSV出力が未実装**。モバイルの **freee / 弥生 / MJS / 汎用** 整形(`src/services/export/formatters/*`)を**サーバ移植**し、`GET /export?format=...&client_id=...` を提供。
- 顧問先ごとに既定フォーマット(`clients.export_default`)。

---

## 11. PC(Web)UI(役割別)

既存 receipt-app web(React+Vite+Tailwind)の画面構成を流用し、**役割別ビュー**＋レスポンシブ化:

- **事務所職員**: 顧問先切替/横断一覧 → 仕分けキュー → 確定 → エクスポート / マスタ管理 / 顧問先・ユーザー管理 / ペアリングQR発行
- **顧問先事務員**: 自社の領収書一覧・補正のみ
- モバイルの確認/出力画面は任意(PC主体)。撮影UIはスマホ専用に残す。

---

## 12. 技術スタック

| 層 | 採用 | 理由 |
|---|---|---|
| Backend | **FastAPI + SQLAlchemy2 + Alembic** | receipt-app の Python ロジックを直接移植できる |
| DB | **PostgreSQL + RLS** | テナント分離を DB で強制 |
| ストレージ | **MinIO(S3互換) or ローカルボリューム** | 自社VM内。画像/音声/PDF。sha256重複排除 |
| 非同期 | ジョブワーカー(既存jobs方式)+ スケジューラ | STT/OCR/取込 |
| AI | プロバイダ抽象(**OpenAI/Gemini/Ollama/whisper**、能力ごと選択) | 事務所ごと設定。自前と外部を混在可 |
| Web | React + Vite + Tailwind | receipt-app web 流用 |
| モバイル | 既存 Tauri(Android/iOS) | 撮影クライアント。保存をAPI化 |
| 配信 | Caddy(単一オリジン) | CORS回避・SPA+APIプロキシ・TLS終端 |

### ホスティング / 運用(自社VM)
- **自社の VM 上に Docker Compose** で一式(api / postgres / minio / caddy)。receipt-app と同じ運用パターンを踏襲。
- **Ollama / faster-whisper は VM ホストに常駐**(コンテナ外、`host.docker.internal` 経由)。GPUがあれば活用。
- TLSは Caddy。バックアップ(PG dump + ストレージ)は VM 側で運用。

### リポジトリ構成
- **`receipt-saas`(新規)**: `api/`(FastAPI backend)+ `web/`(React SPA)を**単一リポジトリ・単一オリジン**で(receipt-app の構成を踏襲)。
- **`receipt-voice-capture-app`(既存)**: モバイル撮影クライアント。保存をAPIへ向け、QRペアリングを追加。
- **`receipt-app`(既存)**: 触らず温存(社内ツール / 参照実装)。
- ロジック移植は **コピー&テナント対応化**(共有ライブラリ化はせず、まずは独立で動かす)。

---

## 13. 移植範囲まとめ

**receipt-app → 新backend(ロジック移植)**
- 仕分けエンジン / 取引先ドメイン照合 / マスタ設計 / 突合 / 全文検索(pg_trgm)/ ジョブ・スケジューラ / Gmail・カード取込(Phase 2)

**モバイル → 新backend(機能移設)**
- STT/OCR/整形 → サーバ実行に / **CSVエクスポート整形** → サーバAPIに

**モバイル本体の改修**
- ローカル保存(Tauri commands)→ **API POST** に差し替え(`session-api.ts` 周辺は分離済みで局所的)
- 端末内AI → 撤去、生データアップロードに
- **QRペアリング認証**の追加(カメラは既に動作)

---

## 14. フェーズ計画

### Phase 1 — MVP(コア縦切り)
目標:**1事務所を登録 → 顧問先をQRで紐付け → スマホで撮影/録音 → サーバAI → PCで確認・仕分け・CSV出力**、が一気通貫で動く。
- テナント中核: firms/clients/users/memberships + **RLS**
- 認証: Web(メール+PW)+ **QRペアリング**(モバイル)
- 取込: `POST /captures`(画像/音声)→ サーバ STT/OCR/整形(事務所キー)→ receipts
- 仕分け(移植・最小)+ マスタ(顧問先単位、テンプレ複製)
- **CSVエクスポート**(モバイル整形を移植)
- PC: 職員ビュー(一覧/仕分け/確定/出力)、顧問先ビュー(自社確認)

### Phase 2 — 拡張
- Gmail/カード明細 取込の移植(顧問先単位)
- マスタ/ユーザー/顧問先 管理画面、複数事務所オンボード
- オフライン送信キュー、画像プレビュー強化、学習ルール充実

### Phase 3 — 運用/商用
- 課金(事務所単位)・AI使用量メータリング
- 監査ログ、SSO(Workspace)、データ保持/バックアップ、権限の細粒度化

---

## 15. 決定事項 / 未決事項

### 決定済み
- **リポジトリ**: 新規 `receipt-saas`(api+web)。`receipt-app` は温存・参照実装。
- **ホスティング**: **自社VM + Docker Compose**(Ollama/whisper はホスト常駐)。
- **AI**: **能力ごとにプロバイダ選択式**(openai/gemini/ollama/whisper)。事務所ごと設定、自前と外部を混在可。
- **マスタ**: 勘定科目/補助科目=**事務所テンプレ＋顧問先上書き**、取引先/学習=顧問先単位。

### 未決(着手後に詰める)
1. **STT/OCRの既定プロバイダ**と品質比較(紙領収書写真のOCR精度。whisper モデルサイズ、qwen2.5vl vs Gemini/OpenAI)。
2. **データ保護**: 会計データ/画像/音声の暗号化・保持期間・バックアップ運用(自社VM前提)。
3. **Gmail取込のマルチテナント**: 事務所ごとの Workspace 委任(DWD)の扱い(Phase 2)。
4. **課金/契約モデル**(Phase 3)。
5. **キー暗号化方式**(`ai_config.*.key_enc` のマスターキー管理)。

---

## 16. 次のアクション(提案)

1. このドキュメントをレビュー・合意。
2. 新規リポジトリ `receipt-saas` を scaffold(FastAPI + Alembic + Postgres + RLS の骨組み + テナント中核テーブル + 認証/ペアリング)。
3. Phase 1 を縦切りで実装(まず1事務所・1顧問先で end-to-end)。
4. モバイルアプリを API クライアント化(保存POST + QRペアリング)。

---

## 17. アプリの2モード(スタンドアロン / サーバ連携)

ストア配布を見据え、モバイルアプリは**2モード**を持つ:

| モード | 対象 | 保存 | AI | 認証 |
|---|---|---|---|---|
| **スタンドアロン** | 個人/小規模(BYOキー) | 端末ローカル | 端末(各自キー) | なし(ローカル) |
| **サーバ連携** | 税理士事務所の顧問先 | サーバ(テナント) | サーバ(事務所キー) | QRペアリング |

- **利点**: ① Apple の最低限機能ガイドライン(4.2)を満たし審査が通りやすい ② 個人/事務所顧問先の2客層を1アプリで ③ スタンドアロン→連携への引き上げ導線。
- **設計**: 撮影UIは共通。`Backend` インターフェースを `LocalBackend`(既存)/`ServerBackend`(新規)で差し替え。`src/api/session-api.ts` 等が継ぎ目。
- **モード判定**: 初回選択 or **QRスキャンで自動的に連携モードへ**。設定画面はモードでキー欄/接続先表示を出し分け。
- **注意**: 撮影フローとBackend I/Fは1本に保つ。モード切替時のデータは v1 では非移行(別物として扱う)。

## 18. Phase 1 進捗(scaffold 済み・検証済み)

`api/`(FastAPI)・`web/`(React)・`docker-compose.yml` を本リポジトリに追加(モノレポ)。`docker compose up` で起動し、以下を**実機検証済み**:
- 全16テーブル + RLS(`ENABLE`/`FORCE`)生成
- 事務所登録 → ログイン → 顧問先作成 → **QR発行→引換(デバイストークン)** → 撮影アップロード→receipt作成 → 一覧
- **テナント分離**: 別事務所から相手のデータが見えないことを確認(制限ロール `receipt_app` 経由)

残: AIワーカー(jobs消費)、仕分けエンジン移植、エクスポート整形移植、S3アップロード、識別テーブルのRLS、モバイルのAPIクライアント化。
