// 日時表示の共通ヘルパ。日付は日本の一般表記 YYYY/MM/DD で表示する
// (データ・API・<input type="date"> の内部値は ISO の YYYY-MM-DD のまま=表示だけ変換)。

// ISO日付/日時文字列 → "YYYY/MM/DD"。null/undefined は '—'。
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso.slice(0, 10).replaceAll('-', '/')
}

// UTCのISO日時 → 閲覧者のローカル時刻(通常JST)で "YYYY/MM/DD HH:mm"。
// 素の slice() 表示だと時差が乗らないため必ず Date で解釈する。
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
