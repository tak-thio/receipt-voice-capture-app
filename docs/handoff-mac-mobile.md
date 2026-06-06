# 引き継ぎ: Mac でモバイルアプリ(iOS)を進める

このドキュメントは、Mac に開発を引き継いで **モバイルアプリ(Tauri 2 / iOS)** を進めるための手引きです。
サーバ側(SaaS: `api/` + `web/`)は Linux 側でほぼ実装済みで、モバイルアプリはその「入力クライアント」です。

---

## 1. どのブランチで作業するか(結論)

- **作業ブランチ: `feature/mobile-ios`**(`feature/saas-backend` から分岐、`origin` に push 済み)
- 理由: モバイルの **server-linked モード** はサーバ API(`/captures`・`/pairing/redeem`)に依存するため、
  最新の `api/` を含む `feature/saas-backend` を土台にしてあります。iOS 固有の作業はこのブランチに分離します。

Mac でのセットアップ:
```bash
git clone git@github.com:tak-thio/receipt-voice-capture-app.git
cd receipt-voice-capture-app
git checkout feature/mobile-ios
```

> Linux 側で SaaS の追加開発を続ける場合は `feature/saas-backend` に積み、頃合いで `feature/mobile-ios` に
> マージ(または rebase)してください。両ブランチの土台は同一コミットです。

ブランチ系譜: `main` → `developer` → `feature/mobile-app` → `feature/saas-backend` → **`feature/mobile-ios`**

---

## 2. リポジトリ構成(モノレポ)

| パス | 中身 |
|---|---|
| `mobile/` | **モバイル/デスクトップ Tauri 2 アプリ**(React UI + Rust)。今回の主作業対象。 |
| `api/` | SaaS バックエンド(FastAPI + SQLAlchemy + Postgres、RLS でテナント分離) |
| `web/` | SaaS 管理画面(React + Vite + Tailwind。事務所/利用者が PC で使う) |
| `docker-compose.yml` / `Caddyfile` | サーバ一式(api/db/minio/caddy)。`http://localhost:8088` |
| `docs/` | 設計・手順書(下記参照) |

---

## 3. モバイルアプリの現状(できていること)

- Tauri 2 のモバイル対応構造(`mobile/src-tauri/src/lib.rs` + `mobile_entry_point`)。
- **Android は生成済み**(`mobile/src-tauri/gen/android/`、Linux でビルド可)。
- reqwest は **rustls-tls**(Android/iOS で OpenSSL リンク回避)。
- ストレージはモバイルで **アプリ専用領域**に解決(`app_data_dir/receipt-sessions`)。
- **2 モード**実装(設定画面で切替):
  - **standalone**: 端末内にセッション保存、STT/OCR/整形は **クラウドAPI を直接**(OpenAI / Gemini)。
  - **server-linked**: QR でペアリング → 撮影/録音を **サーバへアップロード** → サーバ側 AI が処理。
    - 配線: `mobile/src/api/server-api.ts`
      - `pairDevice()` → `POST {serverUrl}/pairing/redeem`(QRトークン→端末トークン)
      - `uploadCapture()` → `POST {serverUrl}/captures`(画像+音声を multipart)
    - 受け側: `api/app/routers/pairing.py`(redeem)、`api/app/routers/captures.py`(create_capture)。
      端末トークンは `Authorization: Bearer` で送られ、`api/app/deps.py:get_principal` が解決。

### まだ無いもの(= Mac での主タスク)
- **iOS は未初期化**(`mobile/src-tauri/gen/apple/` が無い)。Mac で `tauri ios init` が必要。
- iOS 実機での一連の動作確認(録音/撮影/権限/`audio/mp4` の STT 受理など)。

---

## 4. Mac でやること(優先順)

詳細なコマンドは **`docs/mobile-checklist.md` の「iOS」節**にあります。要点のみ:

1. **前提**: Xcode + Command Line Tools、CocoaPods、Node.js、Rust(`rustup`)。
2. iOS 用 Rust ターゲット:
   ```bash
   rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
   ```
3. 依存インストール:
   ```bash
   cd mobile && npm install
   ```
4. **iOS 初期化(初回のみ)**:
   ```bash
   npm run tauri ios init        # → mobile/src-tauri/gen/apple/ を生成
   ```
5. 生成された `Info.plist` に権限文言を追記:
   - `NSMicrophoneUsageDescription`(マイク)
   - `NSCameraUsageDescription`(カメラ)
   （文言は `mobile/src-tauri/Info.plist` から流用可）
6. 実機/シミュレータ起動:
   ```bash
   npm run tauri ios dev
   ```
7. **standalone モードの一周**: 録音→STT、撮影→OCR、保存、エクスポート(共有シート)。
8. **server-linked モードの一周**(下記 5)。
9. `gen/apple/` はコミット対象(ビルド出力 `gen/apple/build/` 等は `.gitignore` 済み)。

---

## 5. server-linked モードの動作確認(サーバ込み)

1. サーバ起動(Mac でローカル検証する場合):
   ```bash
   cp api/.env.example api/.env   # ENCRYPTION_KEY 等を設定(下記注意)
   docker compose up -d           # api / web / db / minio / caddy
   ```
   - 管理画面: `http://localhost:8088`(LAN 実機からは `http://<MacのIP>:8088`)。
   - デモ事務所(検証用): `demo@firm.local` / `demo-pass-123`。
2. 管理画面で **顧問先 → 利用者**を選び **QR を発行**。
3. モバイルアプリの設定で **server-linked** + `serverUrl = http://<MacのIP>:8088/api` を入力し、**QR をスキャン**(`/pairing/redeem`)。
4. 撮影/録音 → アップロード(`/captures`)。
5. 管理画面の **受信箱**に領収書が現れ、AI 処理後に **仕分け**できることを確認。

> `ENCRYPTION_KEY` は Fernet 鍵(`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`)。
> `.env` はコミットしない(`api/.gitignore` 済み)。AIキーは各事務所が管理画面で設定(暗号化保存)。

---

## 6. 既知の注意点・ハマりどころ

- **iOS の録音コンテナ**: MediaRecorder は iOS で `audio/mp4` に着地。STT API(OpenAI/Gemini)が受理するか実機で要検証(`mobile/src/services/audio/`)。
- **WebView 権限**: iOS は Info.plist 文言、Android は実行時権限 + `WebChromeClient.onPermissionRequest`。`getUserMedia` 失敗時は要対応。
- **ストレージ**: 絶対パス指定が無い時のみ `app_data_dir` に解決(`mobile/src-tauri/src/commands/mod.rs:resolve_storage_root`)。保存JSONに端末固有パスを焼かない設計。
- **LAN 越し実機テスト**: サーバは `http://`(自己署名でない)。Mac のファイアウォール/同一LAN を確認。`serverUrl` は末尾 `/api`。
- **rustls**: `reqwest` は `default-features=false` + `rustls-tls`。デスクトップ含め TLS 経路はこれ。
- 既存の詳細・トラブルシュートは `docs/mobile-checklist.md`。

---

## 7. 主要ファイル(モバイル)

- 起動/Rust: `mobile/src-tauri/src/lib.rs`、`main.rs`、`Cargo.toml`(`[lib]` + rustls)
- ストレージ解決: `mobile/src-tauri/src/commands/mod.rs`
- サーバ連携: `mobile/src/api/server-api.ts`、`mobile/src/store/session-store.ts`
- 設定(モード/キー/serverUrl): `mobile/src/pages/SettingsPage.tsx`、`mobile/src/lib/constants.ts`
- 撮影/録音: `mobile/src/pages/CapturePage.tsx`、`mobile/src/services/audio/`
- プラットフォーム判定: `mobile/src/lib/platform.ts`
- 生成物: `mobile/src-tauri/gen/android/`(済)、`mobile/src-tauri/gen/apple/`(Mac で生成)

## 8. 検証チェックリスト(iOS)

- [ ] `tauri ios init` → `gen/apple/` 生成、Xcode で開ける
- [ ] マイク/カメラ権限プロンプト → 許可 → `getUserMedia` 成功
- [ ] standalone: 録音→STT / 撮影→OCR / 保存 / 再起動後にセッション復元 / エクスポート(共有)
- [ ] server-linked: QR ペアリング → 撮影アップロード → 管理画面 受信箱に表示
- [ ] `audio/mp4` が STT API に受理される
- [ ] `npm run tauri ios build` で IPA(配布は Apple Developer 登録が別途必要 $99/年)

## 9. 関連ドキュメント

- `docs/mobile-checklist.md` — Android/iOS の詳細ビルド手順(まず読む)
- `docs/saas-design.md` — サーバ(テナント/RLS/QR/AI)設計
- `docs/architecture.md` / `docs/requirements.md` — 全体像・要件
- `docs/windows-checklist.md` — デスクトップ(Windows)向け手順

---

最終更新: 2026-06-06 / 引き継ぎ元ブランチ `feature/saas-backend`(37 commits ahead of `origin/main`)。
