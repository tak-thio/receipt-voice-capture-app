import type { PairResult } from '../api/server-api'
import type { Connection } from '../types/connection'

/** サーバ応答(PairResult)を端末保存用の Connection に変換する。
 * ConnectScreen の手動接続と、初回起動の自動スタートで共用する。 */
export function toConnection(serverUrl: string, r: PairResult, demo = false): Connection {
  return {
    serverUrl,
    deviceToken: r.access_token,
    clientId: r.client_id,
    firmName: r.firm_name,
    clientName: r.client_name,
    userName: r.user_name,
    jobTitle: r.job_title,
    role: r.role,
    demo,
    individual: r.individual,
    plan: r.plan,
    email: r.email,
  }
}
