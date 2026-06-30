import { ApiError } from '../api/server-api'

/**
 * エラーを「技術詳細は必ずログに残す」かつ「ユーザーには安全で分かりやすい文を返す」処理に正規化する。
 * 生の技術エラー(プラグインの ACL 文字列・ネットワーク内部メッセージ等)はそのままユーザーに見せない。
 *
 * @param e        catch した値(unknown)
 * @param fallback 種別を特定できないときのユーザー向け既定文
 * @param context  ログ用の文脈ラベル(例 'drive.export')
 */
export function toUserMessage(e: unknown, fallback: string, context = ''): string {
  // 握りつぶさない: 技術詳細は必ず残す(debug ビルドは logcat、将来はサーバ送信も可)
  console.error(`[handled error]${context ? ' ' + context : ''}`, e)

  // ネットワーク不通(fetch が throw / オフライン)
  if (
    e instanceof TypeError ||
    (e instanceof Error && /failed to fetch|networkerror|network request failed|load failed/i.test(e.message))
  ) {
    return 'ネットワークに接続できません。通信環境を確認して、もう一度お試しください。'
  }

  // API のエラー応答は status で出し分け
  if (e instanceof ApiError) {
    if (e.status === 401 || e.status === 403) return 'ログイン情報が無効になりました。お手数ですが再度ログインしてください。'
    if (e.status === 429) return '今月の解析上限に達しました。プランをご確認ください。'
    if (e.status >= 500) return 'サーバで問題が発生しました。時間をおいて、もう一度お試しください。'
    // その他の 4xx はサーバが返した日本語 detail を見せてよい(意図したユーザー向け文)
    return e.detail || fallback
  }

  // それ以外(プラグイン/想定外)は技術文を出さず、ログだけ残して既定文を返す
  return fallback
}
