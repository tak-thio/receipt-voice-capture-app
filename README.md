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
- **AI**: 事務所ごとにプロバイダ選択（OpenAI / Gemini / Ollama / whisper）、サーバ側実行。

## 開発

### サーバ（api + web + db）
```bash
cp api/.env.example api/.env   # ENCRYPTION_KEY などを設定
docker compose up --build      # api:8000 / minio:9000 / caddy:8080（単一オリジン）
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
- `main` → `developer` → `feature/mobile-app`（モバイル対応）/ `feature/saas-backend`（SaaS backend）
