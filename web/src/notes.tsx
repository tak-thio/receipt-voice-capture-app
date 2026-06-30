// 付箋 (note labels): shared colour palette + chip display + attach picker.
import type { NoteRow } from './api'
import { Button, cn, Icon, Modal } from './ui'

type ColorDef = { label: string; chip: string; dot: string }

export const NOTE_COLORS: Record<string, ColorDef> = {
  red: { label: '赤', chip: 'bg-red-100 text-red-700 ring-red-200', dot: 'bg-red-500' },
  orange: { label: '橙', chip: 'bg-orange-100 text-orange-700 ring-orange-200', dot: 'bg-orange-500' },
  amber: { label: '黄', chip: 'bg-amber-100 text-amber-800 ring-amber-200', dot: 'bg-amber-500' },
  green: { label: '緑', chip: 'bg-emerald-100 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  teal: { label: '青緑', chip: 'bg-teal-100 text-teal-700 ring-teal-200', dot: 'bg-teal-500' },
  blue: { label: '青', chip: 'bg-sky-100 text-sky-700 ring-sky-200', dot: 'bg-sky-500' },
  indigo: { label: '藍', chip: 'bg-indigo-100 text-indigo-700 ring-indigo-200', dot: 'bg-indigo-500' },
  purple: { label: '紫', chip: 'bg-purple-100 text-purple-700 ring-purple-200', dot: 'bg-purple-500' },
  pink: { label: '桃', chip: 'bg-pink-100 text-pink-700 ring-pink-200', dot: 'bg-pink-500' },
  slate: { label: '灰', chip: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400' },
}
export const NOTE_COLOR_KEYS = Object.keys(NOTE_COLORS)

export function colorOf(key: string): ColorDef {
  return NOTE_COLORS[key] ?? NOTE_COLORS.slate
}

export function NoteChip({ note, className }: { note: NoteRow; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', colorOf(note.color).chip, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', colorOf(note.color).dot)} />
      {note.text}
    </span>
  )
}

export function NoteChips({ ids, notes, empty }: { ids: string[]; notes: NoteRow[]; empty?: React.ReactNode }) {
  const byId = new Map(notes.map((n) => [n.id, n]))
  const active = ids.map((id) => byId.get(id)).filter((n): n is NoteRow => !!n)
  if (active.length === 0) return <>{empty ?? null}</>
  return (
    <span className="inline-flex flex-wrap gap-1">
      {active.map((n) => <NoteChip key={n.id} note={n} />)}
    </span>
  )
}

export function NotePickerModal({
  open, onClose, notes, value, onToggle,
}: {
  open: boolean
  onClose: () => void
  notes: NoteRow[]
  value: string[]
  onToggle: (id: string) => void
}) {
  const set = new Set(value)
  return (
    <Modal open={open} onClose={onClose} title="付箋" size="sm"
      description="この領収書に付ける付箋を選択(クリックで即時反映)"
      footer={<Button variant="primary" onClick={onClose}>閉じる</Button>}>
      {notes.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">
          付箋が登録されていません。<br />「マスタ」→「付箋」で追加してください。
        </p>
      ) : (
        <div className="space-y-1">
          {notes.map((n) => {
            const on = set.has(n.id)
            return (
              <button key={n.id} onClick={() => onToggle(n.id)}
                className={cn('flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors',
                  on ? 'border-brand-300 bg-brand-50' : 'border-slate-200 hover:bg-slate-50')}>
                <NoteChip note={n} />
                {on
                  ? <Icon.Check className="text-brand-600" />
                  : <span className="text-xs text-slate-400">付ける</span>}
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
