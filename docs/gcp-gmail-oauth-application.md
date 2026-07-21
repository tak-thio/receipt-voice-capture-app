# メール取込（Gmail連携）: GCP OAuth 申請手順書

領収ボックスのメール取込は Google OAuth で顧問先の Gmail に接続する。
使用スコープに **制限付きスコープ（restricted scope）`gmail.readonly`** が含まれるため、
一般公開には Google の **アプリ検証（審査）＋ 年次セキュリティ評価（CASA）** が必要。
本書はその GCP 側の設定と申請の手順をまとめる。

> ⚠ Google の審査要件・画面名称は変わりやすい（本書は 2026年時点の情報）。
> 申請前に必ず公式を確認すること:
> - OAuth 検証: https://support.google.com/cloud/answer/13463073
> - 制限付きスコープ / CASA: https://developers.google.com/terms/api-services-user-data-policy

---

## 0. このアプリの実装前提（審査資料に使う事実）

| 項目 | 値（コード上の事実） |
|---|---|
| 要求スコープ | `openid` / `email` / `profile` / **`https://www.googleapis.com/auth/gmail.readonly`**（`api/app/routers/gmail.py` GMAIL_SCOPES） |
| 併用（Drive連携） | `https://www.googleapis.com/auth/drive.file`（非機微。ユーザーが本アプリで作ったファイルのみ） |
| リダイレクトURI | `https://receipt.orderbridge.jp/api/gmail/oauth/callback` / 同 `/api/drive/oauth/callback` |
| サーバ側env | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GMAIL_OAUTH_REDIRECT_URI` / `DRIVE_OAUTH_REDIRECT_URI`（`api/app/config.py`） |
| トークン | `access_type=offline`＋`prompt=consent` でrefresh token取得、DB保存（GmailAccount） |
| 使い方 | 検索クエリ＋期間でメッセージIDを検索し、**添付/本文の領収書・請求書のみ取得**（`api/app/ingest/gmail.py`）。送信・変更・削除は一切しない |
| 公開ページ | プライバシーポリシー `https://receipt.orderbridge.jp/privacy.html` / 利用規約 `/terms.html`（Caddyで公開済み） |

**スコープ最小性の説明（審査で必ず聞かれる）**: メール本文と添付ファイルの取得が必要なため
`gmail.readonly` が最小。`gmail.metadata` はヘッダのみで本文・添付が取れず要件を満たさない。
書込系（modify/send）は不要なので要求しない。

---

## 1. GCPプロジェクトと API 有効化

1. GCPプロジェクトを用意（既存の `receiptbox-prod` に同居可。ただし**審査はプロジェクト単位**なので、Gemini等のAPIキー運用と分けたければ専用プロジェクトでも良い）
2. 「APIとサービス → ライブラリ」で有効化:
   - **Gmail API**
   - Google Drive API（Drive連携も使う場合）

## 2. OAuth 同意画面（ブランディング）

「APIとサービス → OAuth同意画面」:

1. **User Type: 外部（External）**（顧問先=一般のGoogleアカウントが対象のため）
2. アプリ情報:
   - アプリ名: `領収ボックス`
   - サポートメール / デベロッパー連絡先: kawano@itsherpa.com など受信できるもの
   - ロゴ（任意だが設定するとロゴ審査が追加される。急ぐなら最初は無しでも可）
3. **承認済みドメイン**: `orderbridge.jp`
   - 事前に **Google Search Console でドメイン所有権の確認**が必要（DNS TXT が確実）
4. アプリのリンク:
   - ホームページ: `https://receipt.orderbridge.jp/`（アプリの説明とプライバシーポリシーへのリンクがあること — 現状のランディングでOK）
   - プライバシーポリシー: `https://receipt.orderbridge.jp/privacy.html`
   - 利用規約: `https://receipt.orderbridge.jp/terms.html`
5. **スコープの登録**: 上記4スコープ＋`drive.file` を追加。`gmail.readonly` は「制限付き」と表示される

### プライバシーポリシーの必須記載（Limited Use）
制限付きスコープの審査では、ポリシーに **Google API Limited Use 準拠の明記**が求められる。
`privacy.html` に以下の趣旨の一文があるか確認し、無ければ追記する:

> 本アプリが Google API から取得した情報の使用は、[Google API サービスのユーザーデータに関するポリシー](https://developers.google.com/terms/api-services-user-data-policy)（Limited Use の要件を含む）に準拠します。
> Gmail から取得したデータは、ユーザーが指示した領収書・請求書の取込機能の提供のみに使用し、広告目的で使用せず、人間による閲覧は行わず、第三者に販売・提供しません。

## 3. 認証情報（OAuthクライアントID）

「APIとサービス → 認証情報 → 認証情報を作成 → OAuthクライアントID」:

1. 種類: **ウェブアプリケーション**
2. 承認済みリダイレクトURI:
   - `https://receipt.orderbridge.jp/api/gmail/oauth/callback`
   - `https://receipt.orderbridge.jp/api/drive/oauth/callback`
3. 発行された client_id / client_secret を本番VMの `api/.env` に設定:
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   GMAIL_OAUTH_REDIRECT_URI=https://receipt.orderbridge.jp/api/gmail/oauth/callback
   DRIVE_OAUTH_REDIRECT_URI=https://receipt.orderbridge.jp/api/drive/oauth/callback
   ```
   （client_secret の JSON はリポジトリに入れない — gitignore 済みの運用を維持）

## 4. まずは「テスト」公開で動作確認 — ただし制約に注意

同意画面の公開ステータスを **テスト** にし、テストユーザー（自分と検証用アカウント）を追加すれば審査前でも動く。ただし:

| テスト公開の制約 | 影響 |
|---|---|
| テストユーザー **最大100人** | 顧問先展開は不可 |
| **refresh token が7日で失効** | 週1で全アカウント再連携が必要 = 実運用不可 |
| 同意画面に未確認アプリ警告 | 顧問先の心証 |

→ **顧問先に使わせる前に、必ず「本番」公開＋検証（次章）を完了させること。**
（もし現在「テスト」のまま運用しているなら、Gmail連携が7日ごとに切れる原因はこれ。）

## 5. アプリ検証（審査）の申請

同意画面で「アプリを公開」→ 制限付きスコープがあるため検証申請へ進む。

### 提出するもの
1. **スコープの正当化説明**（英語推奨・例文）:
   > Ryoshu-Box is an accounting SaaS for tax-accountant firms in Japan. With the user's consent, it imports receipt/invoice attachments and bodies from the user's Gmail so that the firm can process them for bookkeeping. We request `gmail.readonly` because we must read message bodies and attachments matching user-defined search criteria; we never send, modify, or delete mail. Narrower scopes (e.g. `gmail.metadata`) do not provide attachment/body access required for this user-facing feature.
2. **デモ動画**（YouTube 限定公開でURL提出）。必須要素:
   - OAuth同意フロー全体（**同意画面にアプリ名とclient_idのプロジェクトが見える**こと）
   - ログイン → 設定/メール連携 → Gmail接続 → 取込結果（受信箱に領収書が入る）まで
   - スコープが実際に何に使われるかが分かる操作
3. ホームページ・プライバシーポリシーのURL（上記2章の要件を満たした状態で）

審査はメールでのやり取りになる（数日〜数週間、差し戻しあり）。**申請メールは必ず返信・対応する**（放置すると却下）。

## 6. セキュリティ評価（CASA）— 制限付きスコープ特有

`gmail.readonly` は検証通過に加えて **CASA（Cloud Application Security Assessment）Tier 2** の
完了が求められ、**毎年の再認定**が必要。

- 審査の過程で Google から案内メールが来る（指定の認定ラボ/手順に従う）
- Tier 2 は自己スキャン提出で通る経路がある（認定スキャナでのSAST/DAST結果提出）。指定ラボに依頼する場合は有償
- 対象は本番のWebアプリ（https://receipt.orderbridge.jp）とAPI
- 期限内（案内から一定期間）に完了しないと制限付きスコープが無効化されるので注意

> 費用・手順・指定ラボは頻繁に変わるため、案内メールと公式ページの最新情報に従うこと。

## 7. 公開後の運用

- **年次**: CASA再評価＋（求められれば）再検証
- スコープを追加・変更したら**再審査**（安易に増やさない）
- 割当（クォータ）: Gmail APIの既定quotaで通常運用は十分。大量顧問先で不足したら引き上げ申請
- client_secret ローテーション時は `.env` 更新＋api再起動のみ（コード変更不要）

## 8. チェックリスト

- [ ] Search Console で `orderbridge.jp` 所有権確認
- [ ] Gmail API / Drive API 有効化
- [ ] OAuth同意画面（External・アプリ情報・承認済みドメイン・各URL・スコープ登録）
- [ ] privacy.html に Limited Use 準拠の文言（無ければ追記して再デプロイ）
- [ ] OAuthクライアントID作成・リダイレクトURI 2本登録
- [ ] 本番 `.env` に client_id/secret/redirect 4変数設定 → api 再起動
- [ ] テストユーザーで一連の動作確認（連携→取込→受信箱）
- [ ] デモ動画撮影（同意画面込み）→ YouTube限定公開
- [ ] スコープ正当化文を添えて検証申請
- [ ] Google からの審査メールに随時対応
- [ ] CASA Tier 2 完了
- [ ] 「本番」公開へ切替 → 顧問先への展開開始
- [ ] カレンダーに**年次のCASA再認定**を登録
