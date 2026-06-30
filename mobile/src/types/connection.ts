/** サーバ連携(税理士事務所)の接続情報。端末のペアリングで取得し localStorage に保持。 */
export interface Connection {
  serverUrl: string // 例 https://receipt.orderbridge.jp/api
  deviceToken: string // /pairing/redeem で得たデバイストークン(Bearer)
  clientId: string
  firmName?: string
  clientName?: string
  userName?: string
  jobTitle?: string
  role?: string
  demo?: boolean // デモ接続(サンドボックス)。UIに「デモ中」を出す。
  individual?: boolean // 個人プラン(無料/サブスク)。退会・使用量メーター等を出す。
  plan?: string // 'free' | 'pro' | 'business'
  email?: string | null // 個人アカウントの登録メール。匿名スタート(未登録)なら null/空。
}
