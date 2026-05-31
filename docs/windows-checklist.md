# Windows動作確認チェックリスト

Windowsでこのアプリを確認するときの手順と、失敗時に見る場所の一覧。

## 社内テスター向けの前提

GitHubのリポジトリURLをCodexに渡し、Codexにこのチェックリスト順で作業させる想定です。
実APIキーはリポジトリやチャットログに貼らず、起動後にアプリの設定画面から入力してください。

推奨 clone 先:

```powershell
C:\dev\receipt-voice-capture-app
```

日本語やOneDriveを含むパスでも動く想定ですが、Rust/Tauri依存のビルドで不安定になる場合があります。
失敗した場合は、まず短いASCIIパスで再確認してください。

## 事前確認

- [ ] Windows 10/11である
- [ ] WebView2 Runtime が入っている
- [ ] Visual Studio Build Tools のC++ビルドツールが入っている
- [ ] Node.js / npm が使える
- [ ] Rust / Cargo が使える
- [ ] Git cloneしたパスに日本語や空白が含まれていてもよいが、失敗時は `C:\dev\receipt-voice-capture-app` など短いASCIIパスでも試す

確認コマンド:

```powershell
node -v
npm -v
rustc --version
cargo --version
```

## 初回セットアップ

```powershell
git clone https://github.com/tak-thio/receipt-voice-capture-app.git
cd receipt-voice-capture-app
npm install
```

## ビルド前チェック

```powershell
npm run typecheck
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

補足:

- `cargo check` は Tauri の `frontendDist = "../dist"` を読むため、fresh clone直後は先に `npm run build` で `dist/` を作成してください。
- PowerShellの実行ポリシーで `npm.ps1` が止まる場合は、`npm.cmd install` や `npm.cmd run typecheck` のように `npm.cmd` を明示してください。
- `link.exe not found` が出る場合は Visual Studio Build Tools の C++ build tools が不足しています。

## アプリ起動

```powershell
npm run app:test
```

起動後に確認すること:

- [ ] 設定画面が開ける
- [ ] `Gemini APIキー` または `OpenAI APIキー` を保存できる
- [ ] AI診断を更新して、選択中プロバイダーが `利用可能` になる
- [ ] テスト入力でレコードが作成できる
- [ ] カメラとマイクの権限要求が出る
- [ ] 録音後、音声ファイルが保存される
- [ ] GeminiまたはOpenAI STTで文字起こしできる
- [ ] Gemini OCRまたはローカルOCRで画像からテキスト取得できる
- [ ] レビュー画面で編集できる
- [ ] エクスポート画面でCSV保存ダイアログが出る
- [ ] CSVがWindowsの任意フォルダに保存できる

## 配布ビルド確認

開発起動が通ったあと、配布用 exe のビルドも確認する。

```powershell
npm run tauri build
```

成功すると、Windowsではおおむね次の場所に exe が作成されます。

```powershell
src-tauri\target\release\receipt_voice_capture.exe
```

## 保存先

既定の保存先 `receipt-sessions` は、Windowsではアプリのデータフォルダ配下に作成されます。
通常は次のような場所です。

```powershell
$env:APPDATA\com.tak.receiptvoicecapture\receipt-sessions
```

設定ファイルも同じアプリデータフォルダ配下の `settings.json` に保存されます。
実APIキーを含むため、共有・コミットしないでください。

## ローカルSTT確認

ローカルSTTは必須ではない。AI APIでSTTする場合はこの項目を飛ばしてよい。

```powershell
py -m venv .venv-stt
.\.venv-stt\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r scripts\requirements-stt.txt
```

設定画面で `STTモード` を `ローカル` にし、診断欄で `.venv-stt\Scripts\python.exe` が検出されることを確認する。

## よくある失敗箇所

- `npm install` が失敗する: Node/npmのバージョン、ネットワーク、パス長を確認する
- `cargo check` が失敗する: Visual Studio Build Tools のC++環境を確認する
- `npm run app:test` でWebViewが開かない: WebView2 Runtimeを確認する
- `npm run app:test` 再実行時に exe の削除で失敗する: 前回起動した `receipt_voice_capture.exe` や `cargo` / `node` が残っていないか確認する
- APIキー診断が未設定: 設定画面で保存したあと、AI診断を再実行する
- カメラ/マイクが使えない: Windowsのプライバシー設定でデスクトップアプリのカメラ/マイク許可を確認する
- ローカルOCRが使えない: Tesseractが未インストールの場合はGemini OCRを使う
- ローカルSTTが使えない: `.venv-stt\Scripts\python.exe` が存在するか、`faster-whisper` が入っているか確認する

## 失敗ログとして残すもの

- 実行したコマンド
- エラー全文
- `node -v`
- `npm -v`
- `rustc --version`
- `cargo --version`
- Windowsのバージョン
- clone先のパス

## 修正タスク

- [x] Windows実機で `npm install` を確認する
- [x] Windows実機で `npm run typecheck` / `npm test` を確認する
- [x] Windows実機で `cargo check` / `cargo test` を確認する
- [x] Windows実機で `npm run app:test` を確認する
- [ ] Windows実機で設定画面からAPIキー保存、AI診断、AI整形テストを確認する
- [ ] Windows実機で録音保存、STT、OCR、CSVエクスポートを確認する
- [x] Windowsで相対保存先 `receipt-sessions` の実際の作成場所を確認し、アプリデータフォルダへ移す
- [x] WindowsでTauriの `npm run tauri build` を確認する
