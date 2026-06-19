# モバイル(Android / iOS)ビルド手順

このアプリは Tauri 2 で iOS / Android アプリ化しています。既存の React UI と TS ロジックを流用し、STT / OCR / AI 整形は**すべて外部API**(OpenAI / Gemini など)で実行します(端末ローカルの STT / OCR サイドカーは廃止)。

> 📁 **このドキュメントのコマンドとパスはすべて `mobile/` ディレクトリ基準です。** まず `cd mobile` してから実行してください(モノレポ構成: `mobile/` にモバイルアプリ、`api/`・`web/` がサーバ側)。

## 共通の前提

- Node.js / npm
- Rust ツールチェーン(`rustup`, `cargo`)
- `cd mobile && npm install` 済み

モバイルでは保存先が **アプリ専用データ領域**(`app_data_dir/receipt-sessions`)に解決されます(`mobile/src-tauri/src/commands/mod.rs` の `resolve_storage_root`)。設定画面の「保存先ルート」(絶対パス指定)はモバイルでは非表示・空送信になります。

APIキーは設定画面で保存するか、環境変数(`OPENAI_API_KEY` / `GEMINI_API_KEY`)で渡します。

---

## Android(Linux / macOS / Windows でビルド可)

### 必要なもの
- Android SDK(platform-tools, platforms, build-tools)
- Android NDK(例: 27 系)
- JDK 17

### 環境変数(例)
```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export NDK_HOME="$HOME/Android/Sdk/ndk/27.0.12077973"   # 任意の単一NDKを指す
export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
export PATH="$HOME/.cargo/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"
```

### Rust ターゲット追加
```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

### 初期化(初回のみ)
```bash
npm run tauri -- android init
```
`src-tauri/gen/android/` に Gradle プロジェクトが生成されます。これはコミット対象です。
権限と WebView 対応のため、以下を手動編集済み(再生成時は再適用):
- `gen/android/app/src/main/AndroidManifest.xml`: `RECORD_AUDIO` / `CAMERA` / `MODIFY_AUDIO_SETTINGS` を追加。
- `gen/android/app/src/main/java/com/itsherpa/ffreceipt/MainActivity.kt`: 起動時に CAMERA / RECORD_AUDIO の実行時権限を要求。

### エミュレーター/実機で起動
```bash
# エミュレーター起動(例)
emulator -avd <AVD名> -no-snapshot -no-audio &
adb wait-for-device

npm run tauri -- android dev
```
- 初回は Gradle 8.14.x のダウンロードと Rust の Android 向けビルドで数分かかります。
- デバイスの `/data` 空き容量に注意(debug APK は ~150MB)。`INSTALL_FAILED_INSUFFICIENT_STORAGE` が出たらエミュレーターを `-wipe-data` で起動し直すか、データパーティションを拡張する。

### リリースビルド(APK / AAB)
```bash
npm run tauri -- android build            # AAB(Play配布用)
npm run tauri -- android build --apk      # APK
```
署名鍵の設定は `gen/android` の Gradle 署名設定を参照。Google Play 配布には開発者登録($25 一括)が必要。

---

## iOS(ビルド/配布は macOS + Xcode 必須)

Linux ではビルドできません。Mac で以下を実行します。

### 必要なもの
- macOS + Xcode(Command Line Tools 含む)
- CocoaPods
- Apple Developer 登録($99/年、実機・配布時)

### Rust ターゲット追加
```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
```

### 初期化(初回のみ)
```bash
npm run tauri -- ios init
```
`src-tauri/gen/apple/` に Xcode プロジェクトが生成されます。
生成された `Info.plist` に以下のマイク/カメラ利用文言を追記してください(`src-tauri/Info.plist` の文言を流用可):
```xml
<key>NSMicrophoneUsageDescription</key>
<string>音声入力で領収書データを作成するためにマイクを使用します。</string>
<key>NSCameraUsageDescription</key>
<string>領収書を撮影して保存・照合するためにカメラを使用します。</string>
```

### シミュレーター/実機で起動
```bash
npm run tauri -- ios dev
```
- 録音は iOS WKWebView では `audio/mp4`(m4a)に着地します(`media-recorder-service.ts` のフォールバック実装済み)。STT API がこのコンテナを受理するか実機で確認してください。

### リリースビルド
```bash
npm run tauri -- ios build
```
署名/プロビジョニングは Xcode 側で設定。

---

## 実機/エミュレーターでの動作確認(エンドツーエンド)

1. マイク/カメラの権限プロンプト → 許可 → 録音・カメラプレビューが動く
2. 録音 → 保存 → クラウドSTT(OpenAI/Gemini)で文字起こし
3. 撮影 → 保存 → クラウドOCR(Gemini)で照合
4. レビュー画面で編集 → エクスポート(モバイルは app-data へ保存 + OS共有シート)
5. アプリ再起動後にセッションが復元される(app-data から)

## 既知の注意点(実機で要確認)

- Android WebView の `getUserMedia` は、実行時権限(MainActivity で要求)に加え、WebView 側の `onPermissionRequest` 許可が必要。Tauri/wry が自動許可するかはバージョン依存。失敗する場合は `MainActivity` でカスタム `WebChromeClient` を設定して `request.grant(...)` する。
- iOS の `audio/mp4` を OpenAI/Gemini STT が受理するかは iOS バージョン依存。
- エミュレーターの `/data` 容量不足に注意(上記参照)。
