from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Owner/superuser URL — used by Alembic migrations (DDL, role creation).
    database_url: str = "postgresql+asyncpg://receipt:receipt@localhost:5433/receipt"
    # Restricted, RLS-bound role — used by the running app. Superusers bypass RLS,
    # so the runtime MUST NOT connect as the owner. Falls back to database_url if unset.
    app_database_url: str = ""

    session_secret: str = "dev-session-secret"
    # Fernet key (urlsafe base64, 32 bytes) for encrypting per-firm AI keys.
    encryption_key: str = ""

    # Object storage (S3/MinIO).
    s3_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "receipts"
    s3_region: str = "us-east-1"

    # Self-hosted AI hosts (VM host).
    ollama_host: str = "http://host.docker.internal:11434"
    ollama_text_model: str = "qwen2.5:14b"
    ollama_vision_model: str = "qwen2.5vl:7b"
    whisper_host: str = "http://host.docker.internal:9100"

    cors_origins: str = "http://localhost:5173"
    cookie_secure: bool = False

    # --- Gmail 取り込み (OAuth) -------------------------------------------
    # Google Cloud Console の OAuth クライアント(ウェブアプリ)。WANでのみ機能する
    # (リダイレクトURIに公開HTTPSドメインが必須)。
    google_client_id: str = ""
    google_client_secret: str = ""
    gmail_oauth_redirect_uri: str = ""  # 例 https://receipt.billpo.jp/api/gmail/oauth/callback
    # 取り込み対象を絞る Gmail 検索クエリ(参考実装と同じ)。
    gmail_query: str = (
        '(receipt OR invoice OR "領収" OR "請求" OR "ご利用明細" OR "ご請求" OR "お支払い")'
    )
    gmail_lookback_days: int = 3  # 定期取り込みで遡る日数(増分)
    gmail_poll_interval_hours: int = 4  # 定期取り込みの間隔

    # モバイルのペアリングQRに埋める公開APIベースURL(例 https://receipt.example.com/api)。
    # 設定すると /pairing/issue が {"url","t"} を QR に入れ、1スキャンで端末が接続先+トークンを得る。
    # 空なら QR は bare token のみ(端末側で URL を手入力)。
    public_api_url: str = ""

    # --- FCM プッシュ通知 (Phase D) ---------------------------------------
    # Firebase サービスアカウント鍵JSON(コンテナ内パス)。空なら通知は無効(送信をスキップ)。
    # 秘密情報なのでGitに入れず、サーバで secrets/ をマウントして渡す。
    fcm_credentials_path: str = ""

    # --- デモモード(ストア審査/お試し用) ----------------------------------
    # ログイン不要の「デモを試す」接続先。デモ用顧問先(サンドボックス)の client_id を設定すると
    # /pairing/demo が有効になり、端末がその顧問先の一般社員として接続できる。空ならデモ無効。
    demo_client_id: str = ""

    # --- 個人プラン(無料/サブスク) ---------------------------------------
    # 個人サインアップで作る1人用firmが継承するAI設定の参照元firm(プラットフォームのGemini鍵)。
    # 空なら個人firmはAI未設定=解析不可。本番では Gemini が入った firm の id を設定する。
    platform_ai_firm_id: str = ""

    # --- アプリ内課金 (IAP / ⑤) -------------------------------------------
    # Google Play Developer API のサービスアカウント鍵JSON(コンテナ内パス)。空なら購入検証は無効。
    play_service_account_path: str = ""
    play_package_name: str = "com.itsherpa.ffreceipt"
    # サブスク(pro)の商品ID(Play Console の定期購入で作る)。
    play_pro_product_id: str = "pro_monthly"

    @property
    def runtime_database_url(self) -> str:
        return self.app_database_url or self.database_url

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
