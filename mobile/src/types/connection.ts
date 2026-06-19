/** サーバ連携(税理士事務所)の接続情報。端末のペアリングで取得し localStorage に保持。 */
export interface Connection {
  serverUrl: string // 例 https://receipt.billpo.jp/api
  deviceToken: string // /pairing/redeem で得たデバイストークン(Bearer)
  clientId: string
  firmName?: string
  clientName?: string
  userName?: string
  jobTitle?: string
  role?: string
  demo?: boolean // デモ接続(サンドボックス)。UIに「デモ中」を出す。
}
