import { create } from 'zustand'
import type { Connection } from '../types/connection'

const STORAGE_KEY = 'rvc.connection'
const AUTO_KEY = 'rvc.autoCapture'
const MODE_KEY = 'rvc.uploadMode' // 'company'(請求書) | 'expense'(経費精算)

export type UploadMode = 'company' | 'expense'

function loadUploadMode(): UploadMode | null {
  try {
    const v = localStorage.getItem(MODE_KEY)
    return v === 'company' || v === 'expense' ? v : null
  } catch {
    return null
  }
}

function loadConnection(): Connection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Connection) : null
  } catch {
    return null
  }
}

// 自動シャッター(連続撮影)の既定。未設定なら ON(連続撮影モード)。
function loadAutoCapture(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'off'
  } catch {
    return true
  }
}

interface AppState {
  ready: boolean
  connection: Connection | null
  autoCapture: boolean
  uploadMode: UploadMode | null // 未設定(null)なら役割で既定を決める
  toast: string | null
  init: () => void
  setConnection: (connection: Connection) => void
  setAutoCapture: (on: boolean) => void
  setUploadMode: (mode: UploadMode) => void
  showToast: (message: string) => void
  hideToast: () => void
  disconnect: () => void
}

/** サーバ連携専用アプリの最小状態。接続情報と撮影設定を保持する。 */
export const useAppStore = create<AppState>((set) => ({
  ready: false,
  connection: null,
  autoCapture: true,
  uploadMode: null,
  toast: null,
  init: () =>
    set({ connection: loadConnection(), autoCapture: loadAutoCapture(), uploadMode: loadUploadMode(), ready: true }),
  setConnection: (connection) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connection))
    set({ connection })
  },
  setAutoCapture: (on) => {
    try {
      localStorage.setItem(AUTO_KEY, on ? 'on' : 'off')
    } catch {
      /* localStorage 不可でもメモリ状態は更新する */
    }
    set({ autoCapture: on })
  },
  setUploadMode: (mode) => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      /* localStorage 不可でもメモリ状態は更新する */
    }
    set({ uploadMode: mode })
  },
  showToast: (message) => set({ toast: message }),
  hideToast: () => set({ toast: null }),
  disconnect: () => {
    localStorage.removeItem(STORAGE_KEY)
    set({ connection: null })
  },
}))
