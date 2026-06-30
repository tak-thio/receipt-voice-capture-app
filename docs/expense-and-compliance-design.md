# 経費精算 ＋ 電子帳簿保存法対応 設計メモ

受領書アプリ(領収ボックス)への追加機能の設計・実装計画。2026-06-18 起票。

## スコープ
1. **監査ログ**(共通基盤・最優先) — 訂正削除履歴 = 電帳法の真実性要件 ＋ 各機能の操作履歴
2. **締め日チェック**(⑥) — 顧問先ごとのロック日以前の領収書を「期間外」警告
3. **検索拡張** — 取引年月日・金額・取引先(範囲・組合せ) = 電帳法の可視性要件
4. **原本保存の担保** — 無加工原本・sha256改ざん検知・取込日時 = 電帳法の保存要件
5. **経費精算** — 申請→承認/否認/再提出/取下げ(**支払い実行なし**)
6. **PUSH通知**(FCM, Firebase用意済) — 承認者/申請者へ

非コード(別プロセス): 事務処理規程(運用文書)、JIIMA認証。コードは技術要件を満たすところまで。

---

## 1. 監査ログ(共通基盤)
- append-only テーブル `audit_logs`: `id, firm_id, client_id, actor_user_id, action, target_type, target_id, before(jsonb), after(jsonb), created_at`。
- `action`: created / updated / deleted / approved / rejected / journalized / submitted / withdrawn / resubmitted など。
- `target_type`: receipt / expense_claim / journal など(他機能でも使えるよう汎用)。
- 領収書の編集・削除・承認・仕訳、経費申請の各操作で記録。**電帳法の訂正削除履歴**を満たす。
- 表示: 対象ごとに履歴(誰が・いつ・何を・前→後)。client-scoped RLS。

## 2. 締め日(⑥) — backend投入済・UI残
- `clients.closing_date`(投入済)。受信箱/仕分けで `取引日 <= 締め日` を赤「期間外」警告(**警告のみ・仕訳は可**)。

## 3. 検索拡張(可視性)
- 取引年月日・取引金額(範囲)・取引先での検索＋2項目以上の組合せ。受信箱/経費一覧。

## 4. 原本保存(保存)
- 原本は無加工で保存(AI送信用ダウンスケールは別コピー=既存設計)。`files.sha256` で改ざん検知。取込日時(`created_at`)。領収書↔仕訳の相互関連性(既存)。

## 5. 経費精算
- モデル:
  - `expense_claim`: id, firm_id, client_id, applicant_user_id, title, status(draft/submitted/approved/rejected/withdrawn), approver_user_id, approved_at, reject_reason, journalize_on_approve(bool), timestamps
  - `expense_claim_item`: claim_id, receipt_id(**既存の取込済み領収書を束ねる** = AI抽出を活用)
- ワークフロー: draft→submitted→(approved | rejected)、rejected→(修正→resubmit→submitted) | withdrawn、submitted→withdrawn。
- 承認者 = 顧問先の管理者/経理。**自己承認禁止**(applicant ≠ approver)。
- 承認時、`journalize_on_approve` なら束ねた領収書を**仕訳済み(journalized)**に(借方=各領収書の科目、貸方=**マスタ既定**)。
- マスタ: 経費精算の既定貸方科目(顧問先設定)。
- **領収書添付必須＋整合チェック**(金額・日付・締め日[§2])。
- **顧問先ごと ON/OFF**(Client のフィーチャーフラグ)。
- 画面: 申請 = モバイル＋web / 承認 = web の作業画面(一覧・フィルタ: 申請中/承認/否認/取下げ)。

## 6. PUSH通知(FCM)
- Firebase(用意済)。Tauri Android で FCM トークン取得 → デバイスに保存(device_sessions 等)→ サーバから FCM 送信。
- 通知: 承認者へ「新規申請」、申請者へ「承認/否認」。

---

## フェーズ
- **A**: 監査ログ(共通基盤) ＋ 締め日警告UI(⑥) ＋ 検索拡張 — web/backend。電帳法の要＋すぐ効く。
- **B**: 経費精算コア(web) — 申請(複数束ね)/承認作業画面/仕訳作成(マスタ既定)/添付必須・締め日整合。Aの監査ログに乗る。
- **C**: モバイル — 経費申請をアプリからも ＋ **自動シャッター完全削除を同梱** → APK再ビルド。
- **D**: PUSH通知(FCM)。

## 電帳法マッピング
| 要件 | 対応 |
|---|---|
| 真実性(訂正削除履歴) | §1 監査ログ |
| 可視性(検索/表示) | §3 検索拡張 ＋ 既存プレビュー/DL |
| 保存(原本/解像度/改ざん検知/相互関連) | §4 ＋ 既存の原本保存・仕訳紐付け |
| (非コード) | 事務処理規程・JIIMA認証 |
