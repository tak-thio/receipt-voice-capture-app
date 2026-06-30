# 運営コンソール（operator / 運営）— アクセスと初期アカウント

税理士事務所(firm)の **上位レイヤー** として、全事務所を作成・管理するプラットフォーム運営者(operator)の窓口。
テナント(事務所職員・顧客)の利用とは **別ポート** に分離してあり、各事務所の領収書データには一切アクセスしない。

> ⚠️ 開発環境のため、このドキュメントには初期パスワードを平文で記載しています。
> 実運用に移行する際は **必ずローテート**（`scripts/create_operator.py` で再設定）し、この記載を削除すること。

---

## アクセスURL

| 環境 | 用途 | URL |
|---|---|---|
| **本番** | **運営コンソール** | **https://receipt.orderbridge.jp:8443/operator.html** （※FWで運営者IPのみ許可） |
| 本番 | テナント（事務所/顧客） | https://receipt.orderbridge.jp/ |
| ローカル | 運営コンソール | http://localhost:8088/operator.html |
| ローカル | テナント | http://localhost:8088/ |

- 本番の運営面は **`:8443` 専用ポート**でのみ提供。公開 `:443` 側では運営ルート(`/operator*`, `/api/operator/*`)は **404** で遮断される。
- `:8443` はファイアウォールで **運営者の送信元IPのみ許可** する前提（IP許可リスト）。

---

## 初期アカウント

### 運営（operator）

| 環境 | メール（ログインID） | パスワード |
|---|---|---|
| **本番** | `kawano@itsherpa.com` | `lVFVhjORScMgGJaFFnl1OljX` |
| ローカル | `ops@local.test` | `OpsPw_Local_123456` |

> 運営アカウントは専用テーブル `operators` に保存され、テナントの `users` とは完全に別。
> 同じメールがテナント側ユーザーとして存在しても衝突しない（別テーブル・別Cookie `op_session`）。

### テナント（参考・本番のテスト事務所）

| 事務所 | owner メール | パスワード | 備考 |
|---|---|---|---|
| テスト事務所 | `kawano@itsherpa.com` | `5A5z1cqiD3Rg1ouvu2NylbLxgmh1` | 検証用に作成した firm_owner |

---

## 運営アカウントの作成・パスワード再設定（CLI）

公開のサインアップは無い（`/auth/register-firm` は撤去済み）。運営アカウントは下記CLIで作成・更新する。

```bash
# 本番（VM の ~/receipt-app で）
docker compose exec api python scripts/create_operator.py --email ops@example.com --name "運営"
#   --password を省略すると強力なパスワードを自動生成して表示
#   既存メールに対して実行すると、そのアカウントのパスワード/氏名を更新（＝ローテート）

# ローカル
docker compose exec api python scripts/create_operator.py --email ops@local.test --name "運営" --password "..."
```

---

## できること（運営コンソール）

ログイン後、以下を操作できる（各事務所の領収書データは表示されない）:

- **新規事務所**: 税理士事務所 + その管理者(firm_owner)アカウントを作成
- **一覧**: 事務所名 / プラン / 状態 / owner / 作成日
- **編集**: 事務所名・プラン・状態の変更
- **停止 / 再開**: 状態を `suspended`/`active` に変更（停止中の事務所はテナント側でログイン不可）

作成された事務所の owner は、テナント側（`https://receipt.orderbridge.jp/`）にログインして顧客(顧問先)を登録・運用する。

---

## 関連
- 本番デプロイ手順: [`deploy-production.md`](deploy-production.md)
- 全体設計: [`saas-design.md`](saas-design.md)
- 運営面のポート分離設定: `Caddyfile.prod`（`:443` と `:8443` の2サイト）/ `docker-compose.prod.yml`（caddy `8443:8443`）
