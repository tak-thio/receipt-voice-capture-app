// Minimal toast system: a provider + useToast() hook. Replaces inline status
// text with transient, non-blocking notifications.
import { createContext, useContext, useState, type ReactNode } from 'react'
import { cn, Icon } from './index'

type ToastKind = 'success' | 'error' | 'info'
type Toast = { id: number; kind: ToastKind; message: string }

const ToastCtx = createContext<(kind: ToastKind, message: string) => void>(() => {})

let seq = 1

const STYLE: Record<ToastKind, { ring: string; icon: ReactNode }> = {
  success: { ring: 'ring-emerald-200', icon: <Icon.Check className="text-emerald-600" /> },
  error: { ring: 'ring-red-200', icon: <Icon.Alert className="text-red-600" /> },
  info: { ring: 'ring-sky-200', icon: <Icon.Alert className="text-sky-600" /> },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  function push(kind: ToastKind, message: string) {
    const id = seq++
    setToasts((t) => [...t, { id, kind, message }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800)
  }

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex animate-slide-up items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-700 shadow-pop ring-1 ring-inset',
              STYLE[t.kind].ring,
            )}
          >
            <span className="mt-0.5 flex-shrink-0 text-base">{STYLE[t.kind].icon}</span>
            <span className="min-w-0 flex-1">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const push = useContext(ToastCtx)
  return {
    success: (m: string) => push('success', m),
    error: (m: string) => push('error', m),
    info: (m: string) => push('info', m),
    /** Wrap an async action: shows the error toast on throw, returns ok flag. */
    async run(fn: () => Promise<unknown>, okMessage?: string): Promise<boolean> {
      try {
        await fn()
        if (okMessage) push('success', okMessage)
        return true
      } catch (e) {
        push('error', String(e instanceof Error ? e.message : e))
        return false
      }
    },
  }
}
