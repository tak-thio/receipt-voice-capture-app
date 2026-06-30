# Google Play 申請チェックリスト

対象: 領収ボックス / `com.itsherpa.ffreceipt`

このメモは Play Console に入力する値と、提出前に実機・本番環境で確認する項目をまとめたものです。

## 1. アプリ情報

| 項目 | 入力値 |
|---|---|
| アプリ名 | 領収ボックス：レシート・領収書をAIで整理 |
| デフォルト言語 | 日本語 |
| アプリ / ゲーム | アプリ |
| 無料 / 有料 | 無料 |
| パッケージ名 | `com.itsherpa.ffreceipt` |
| 商品ID | `pro_monthly` |
| 定期購入 | Proプラン: 3,000円/月(税込)、月500枚 |

ストア掲載文は [store-listing.md](store-listing.md) を使う。

## 2. 法務URL

本番公開後、以下を Play Console に入力する。ドメインは本番の公開URLに置き換える。

| 用途 | パス |
|---|---|
| プライバシーポリシー | `https://<本番ドメイン>/privacy.html` |
| 利用規約 | `https://<本番ドメイン>/terms.html` |
| 特商法表記 | `https://<本番ドメイン>/tokushoho.html` |
| アカウント削除 | `https://<本番ドメイン>/account-deletion.html` |

該当ファイルは `web/public/` 配下にある。提出前に、ログインなし・アプリ外ブラウザからアクセスできることを確認する。

## 3. アプリへのアクセス

審査担当者は初回起動後、登録不要で個人利用を開始できる。

推奨入力:

```text
アプリ初回起動時に、登録不要の無料プランとして自動開始できます。
追加のログイン情報は不要です。

会社・税理士事務所との連携機能は任意機能です。審査では、初回起動後の個人利用モードで、撮影、AI読み取り、受信箱、設定、退会を確認できます。
```

本番 API 側で以下が設定済みであること:

| 環境変数 | 目的 |
|---|---|
| `PUBLIC_API_URL` | アプリから接続する公開 API |
| `PLATFORM_AI_FIRM_ID` または個人プラン用 AI キー | 個人利用のAI解析 |
| `FREE_GEMINI_API_KEY` | 無料プラン用の解析キーを分ける場合 |
| `PAID_GEMINI_API_KEY` | Proプラン用の解析キーを分ける場合 |

## 4. データセーフティ申告

実装・プライバシーポリシーに合わせた申告下書き。

| データ種類 | 収集 | 共有 | 用途 |
|---|---:|---:|---|
| メールアドレス | はい | いいえ | アカウント管理、ログイン、復元 |
| パスワード | はい | いいえ | アカウント認証。平文保存しない |
| 写真/画像、PDF | はい | 条件付き | 領収書等のAI読み取り、保存、連携先への提出 |
| 音声 | はい | 条件付き | 任意の音声メモ、AI文字起こし |
| アプリ内操作 / 利用枚数 | はい | いいえ | 機能提供、プラン上限、品質改善 |
| デバイスID等 | はい | はい | Firebase Cloud Messaging の通知配信 |
| 購入情報 | はい | はい | Google Play Billing による定期購入管理 |

補足:

- 送信時は HTTPS/TLS。
- データはサーバに保存される。
- 退会で個人アカウントと取り込みデータを削除できる。
- 会社・税理士事務所と連携した場合、撮影データと解析結果は連携先に共有される。
- 広告目的のトラッキングは行わない。

## 5. 権限申告

Android Manifest の主な権限:

| 権限 | 理由 |
|---|---|
| `INTERNET` | API通信、AI解析、ログイン、課金検証 |
| `CAMERA` | 領収書・レシートの撮影 |
| `RECORD_AUDIO` | 任意の音声メモ録音 |
| `MODIFY_AUDIO_SETTINGS` | 録音機能の安定化 |
| `POST_NOTIFICATIONS` | 解析完了・経費申請などの通知 |

審査用説明では、カメラ・マイクは領収書入力のためであり、任意利用であることを明記する。

## 6. 定期購入

Play Console で作成する定期購入:

| 項目 | 値 |
|---|---|
| 商品ID | `pro_monthly` |
| 表示名 | Proプラン |
| 価格 | 3,000円/月(税込) |
| 内容 | 月500枚までAI解析 |

提出前確認:

- Play Console の商品IDと `PLAY_PRO_PRODUCT_ID=pro_monthly` が一致している。
- `PLAY_PACKAGE_NAME=com.itsherpa.ffreceipt` が一致している。
- `PLAY_SERVICE_ACCOUNT_PATH` が本番サーバで有効。
- 購入直後に `/billing/google/verify` が成功し、プラン表示が Pro になる。
- RTDN を使う場合、`PLAY_RTDN_SECRET` と Pub/Sub push URL が設定済み。

## 7. リリース前確認

- [ ] 本番ドメインで `privacy.html` / `terms.html` / `tokushoho.html` / `account-deletion.html` が外部公開されている。
- [ ] 初回起動で無料プランが開始できる。
- [ ] 設定画面からメール登録、ログアウト、退会ができる。
- [ ] カメラ権限を許可して撮影できる。
- [ ] マイク権限を許可して音声メモを付けられる。
- [ ] 領収書を送信し、AI解析結果が受信箱に出る。
- [ ] 無料プランは月30枚、Proプランは月500枚として動く。
- [ ] Google Play 内部テストで `pro_monthly` の購入・復元・解約後の挙動を確認する。
- [ ] AAB が release 署名されている。
- [ ] `versionCode` が Play Console に提出済みの値より大きい。

## 8. ビルド

`mobile/` で実行:

```bash
npm run typecheck
npm test
npm run tauri -- android build
```

生成された AAB を Play Console の内部テストにアップロードして、審査前に実機で確認する。
