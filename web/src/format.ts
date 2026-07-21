// 日時表示の共通ヘルパ。
// サーバはUTCのISO文字列(+00:00)を返すため、素の slice() 表示だと時差が乗らない。
// 必ず Date で解釈して閲覧者のローカル時刻(通常JST)で表示する。
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
