import { create } from 'zustand'
import type { Connection } from '../types/connection'

const STORAGE_KEY = 'rvc.connection'

function loadConnection(): Connection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Connection) : null
  } catch {
    return null
  }
}

interface AppState {
  ready: boolean
  connection: Connection | null
  init: () => void
  setConnection: (connection: Connection) => void
  disconnect: () => void
}

/** サーバ連携専用アプリの最小状態。接続情報のみを保持する。 */
export const useAppStore = create<AppState>((set) => ({
  ready: false,
  connection: null,
  init: () => set({ connection: loadConnection(), ready: true }),
  setConnection: (connection) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connection))
    set({ connection })
  },
  disconnect: () => {
    localStorage.removeItem(STORAGE_KEY)
    set({ connection: null })
  },
}))
