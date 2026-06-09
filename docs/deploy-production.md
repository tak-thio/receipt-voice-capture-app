# 本番デプロイ手順(自社VM + ドメイン + TLS)

現行デプロイ先: **`receipt.billpo.jp`**(`its-receipt@receipt.billpo.jp`, Ubuntu 24.04)。
構成は [`architecture.md`](architecture.md) / [`saas-design.md`](saas-design.md) を参照。

## 前提
- ドメインのDNS A レコードがVMの公開IPを指している(Caddyの自動TLSに必須)。
- VMで **80 / 443 が外部到達可能**(Let's Encrypt チャレンジ用)。
- VMに Docker Engine + compose plugin(`curl -fsSL https://get.docker.com | sudo sh`)。

## ポート公開の方針(重要)
**Docker は ufw を迂回して publish する**ため、バインド先を明示する。公開は **caddy(80/443)のみ**:
- `caddy`: `0.0.0.0:80,443`(TLS終端)
- `api`: `127.0.0.1:8000`(localhostのみ・SSHトンネルでデバッグ)
- `minio`: `127.0.0.1:9000/9001`(localhostのみ)
- `db`: ホスト未公開(docker内部ネットワークのみ)

確認: `sudo ss -tlnp` で 0.0.0.0 にいるのが 22/80/443 だけであること。

## 手順
1. **web をビルド**(ローカル)し、`api/` と `web/dist/` をVMへ転送(例: tar over ssh)。`mobile/`・`.git`・`node_modules`・`__pycache__`・`api/.env` は除外。
   ```bash
   (cd web && npm ci && npm run build)
   tar czf - --exclude='__pycache__' --exclude='*.pyc' --exclude='.env' --exclude='node_modules' \
     -C . api web/dist | ssh its-receipt@receipt.billpo.jp 'mkdir -p ~/receipt-app && tar xzf - -C ~/receipt-app'
   ```
2. **本番設定を配置**: `docker-compose.prod.yml` を VM の `~/receipt-app/docker-compose.yml` として、`Caddyfile.prod` を `~/receipt-app/Caddyfile` として置く(ドメイン/メールを自分のものに)。
3. **シークレットを生成**(VM上、値は出力しない)。`~/receipt-app/.env`(compose展開用)と `~/receipt-app/api/.env`(API用):
   ```bash
   # .env  (compose interpolation)
   POSTGRES_USER=receipt
   POSTGRES_PASSWORD=$(openssl rand -hex 24)
   POSTGRES_DB=receipt
   MINIO_ROOT_USER=mio$(openssl rand -hex 6)
   MINIO_ROOT_PASSWORD=$(openssl rand -hex 24)
   # api/.env  (主要キーのみ抜粋。.env.example が雛形)
   DATABASE_URL=postgresql+asyncpg://receipt:<上のPGPASS>@db:5432/receipt
   APP_DATABASE_URL=postgresql+asyncpg://receipt_app:receipt_app@db:5432/receipt  # 0002が作る制限ロール
   SESSION_SECRET=$(openssl rand -hex 32)
   ENCRYPTION_KEY=$(openssl rand -base64 32 | tr '+/' '-_')   # Fernet鍵。★必ずバックアップ
   S3_ENDPOINT=http://minio:9000
   S3_ACCESS_KEY=<MINIO_ROOT_USER>
   S3_SECRET_KEY=<MINIO_ROOT_PASSWORD>
   S3_BUCKET=receipts
   COOKIE_SECURE=true      # https 必須
   CORS_ORIGINS=           # 単一オリジンなので空
   ```
   `chmod 600 .env api/.env`。**`ENCRYPTION_KEY` を失うと各事務所の暗号化AIキーが復号不能**になるので必ず保管。
4. **起動**(初回はビルド + Caddyが証明書取得):
   ```bash
   cd ~/receipt-app && docker compose up -d --build   # 必要なら sudo
   ```
5. **MinIO バケット作成**(モバイルのアップロード用):
   ```bash
   set -a; . ./.env; set +a
   docker run --rm --network receipt-app_default --entrypoint sh minio/mc -c \
     "mc alias set m http://minio:9000 \"$MINIO_ROOT_USER\" \"$MINIO_ROOT_PASSWORD\" && mc mb --ignore-existing m/receipts"
   ```
6. **検証**:
   ```bash
   curl -sS -o /dev/null -w "%{http_code} tls=%{ssl_verify_result}\n" https://<domain>/        # 200 tls=0
   curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://<domain>/api/auth/login \
     -H 'content-type: application/json' -d '{"email":"x","password":"x"}'                      # 401
   ```

## AI(全て外部API)
事務所ごとに管理画面の「設定」でプロバイダ(OpenAI/Gemini=キー、Ollama/whisper=別サーバのエンドポイントURL)を設定する。サーバ機上ではモデルを動かさない。詳細は [`architecture.md`](architecture.md)。

## モバイル(server-linked)
アプリの `serverUrl` を `https://<domain>/api` に設定 → 管理画面で利用者QR発行 → アプリでスキャン → 撮影が `/captures` に届く。**公開ホストは https 必須**(アプリが http を拒否)。
