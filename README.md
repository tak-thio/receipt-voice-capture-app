# 領収書SaaS（モノレポ）

税理士事務所向けのマルチテナント領収書システム。顧問先がスマホで領収書を入力し、
事務所がPCで仕分け・確認・会計ソフト連携用にエクスポートする。

全体設計は [`docs/saas-design.md`](docs/saas-design.md) を参照。

## 構成

| パッケージ | 中身 | 技術 |
|---|---|---|
| [`mobile/`](mobile/) | 撮影クライアント（スマホ）。スタンドアロン / サーバ連携の2モード | Tauri 2 + React + Rust |
| [`web/`](web/) | PC向け確認・仕分け・出力 SPA | React + Vite + Tailwind |
| [`api/`](api/) | マルチテナント backend（テナント/認証/AI/仕分け/エクスポート） | FastAPI + PostgreSQL(RLS) |
| [`docs/`](docs/) | 設計ドキュメント | — |

- **テナント分離**: `firm（事務所）→ client（顧問先）` を PostgreSQL の RLS で強制。
- **認証**: Web=セッション、モバイル=QRペアリング。
- **AI**: 事務所ごとに能力(STT/OCR/整形)単位でプロバイダ選択（OpenAI / Gemini / Ollama / whisper）。**すべて外部APIで実行**し、サーバ機上ではモデルを動かさない（Ollama/whisper も別サーバのエンドポイントをAPI呼び出し）。

## 開発

### サーバ（api + web + db）
```bash
cp api/.env.example api/.env   # ENCRYPTION_KEY などを設定
docker compose up --build      # web/api は Caddy 単一オリジン http://localhost:8088
```
詳細は [`api/README.md`](api/README.md)。

### モバイルアプリ
```bash
cd mobile
npm install
npm run app:test               # Tauri デスクトップ起動
# Android: docs/mobile-checklist.md 参照
```
詳細は [`mobile/README.md`](mobile/README.md)。

## ブランチ
- **`developer`（統合基点）** → `feature/saas-backend`（サーバ作業）/ `feature/mobile`（アプリ作業）
- メインリポジトリ: 会社GitLab `git@git.itsherpa.net:itsherpa/ai/receipt-voice-capture-app.git`
