# Receipt SaaS — API (backend)

Multi-tenant FastAPI backend. See `../docs/saas-design.md` for the full design.

- **Tenancy**: firm → client, isolated by PostgreSQL **RLS** (alembic `0001`).
- **Auth**: web session cookie + mobile **QR device pairing** (`/pairing`).
- **AI**: per-firm, per-capability providers (OpenAI / Gemini / Ollama / whisper)
  selected via `firms.ai_config` and built in `app/ai/factory.py`.

## Layout
```
app/
  config.py            settings
  db.py                async engine + RLS context (set_rls_context)
  models.py            tenant / receipt / master tables
  security.py          passwords, sessions, token hashing, AI-key encryption
  deps.py              principal resolution + RLS binding
  ai/                  capability providers + factory
  routers/             auth, pairing, clients, captures, receipts, masters, journal, export
alembic/               migrations (0001 = schema + RLS policies)
```

## Run (from repo root)
```bash
cp api/.env.example api/.env   # set ENCRYPTION_KEY (Fernet) and secrets
docker compose up --build      # api :8000, db :5433, minio :9000/9001, caddy :8080
# Single origin via Caddy: http://localhost:8080  (API under /api)
```
Migrations run automatically (`alembic upgrade head`) on api start.

## Quick smoke test
```bash
# Bootstrap a firm + owner
curl -X POST localhost:8000/auth/register-firm -H 'content-type: application/json' \
  -d '{"firm_name":"テスト会計","email":"owner@example.com","password":"pw"}'
```

## Phase-1 TODO (ported from receipt-app / mobile)
- AI worker that consumes `jobs` (stt/ocr/format) via `ai.factory`.
- Journaling engine `journal.suggest()/learn()` (from receipt-app `app/journal.py`).
- Export formatters freee/弥生/MJS (from mobile `src/services/export/formatters`).
- Object storage upload (S3/MinIO) in `captures._store_file`.
- RLS on identity tables; firm template → client master copy on client create.
