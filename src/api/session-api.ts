import { DEFAULT_SETTINGS } from '../lib/constants'
import { maybeInvoke } from './tauri'
import type { Session } from '../types/domain'
import type { AppSettings } from '../types/settings'

const CURRENT_SESSION_KEY = 'receipt-app:current-session-id'

function sessionKey(sessionId: string): string {
  return `receipt-app:session:${sessionId}`
}

function rememberCurrentSession(sessionId: string): void {
  localStorage.setItem(CURRENT_SESSION_KEY, sessionId)
}

function buildEmptySession(settingsSnapshot: AppSettings): Session {
  const now = new Date().toISOString()
  return {
    id: `session-${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    settingsSnapshot,
    records: [],
  }
}

export async function createSession(settingsSnapshot: AppSettings = DEFAULT_SETTINGS): Promise<Session> {
  const tauriSession = await maybeInvoke<Session>('create_session', {
    settingsSnapshot,
    storageRoot: settingsSnapshot.storageRoot,
  })

  if (tauriSession) {
    rememberCurrentSession(tauriSession.id)
    return tauriSession
  }

  const session = buildEmptySession(settingsSnapshot)
  localStorage.setItem(sessionKey(session.id), JSON.stringify(session))
  rememberCurrentSession(session.id)
  return session
}

export async function loadSession(sessionId: string, storageRoot?: string): Promise<Session | null> {
  const tauriSession = await maybeInvoke<Session | null>('load_session', {
    sessionId,
    storageRoot,
  })
  if (tauriSession) {
    rememberCurrentSession(sessionId)
    return tauriSession
  }

  const raw = localStorage.getItem(sessionKey(sessionId))
  return raw ? (JSON.parse(raw) as Session) : null
}

export async function loadCurrentSession(storageRoot?: string): Promise<Session | null> {
  const tauriSession = await maybeInvoke<Session | null>('load_current_session', {
    storageRoot,
  })
  if (tauriSession) {
    rememberCurrentSession(tauriSession.id)
    return tauriSession
  }

  const currentSessionId = localStorage.getItem(CURRENT_SESSION_KEY)
  if (!currentSessionId) {
    return null
  }

  return loadSession(currentSessionId, storageRoot)
}

export async function saveSession(session: Session, storageRoot?: string): Promise<Session> {
  session.updatedAt = new Date().toISOString()

  const tauriSession = await maybeInvoke<Session>('save_session', { session, storageRoot })
  if (tauriSession) {
    rememberCurrentSession(tauriSession.id)
    return tauriSession
  }

  localStorage.setItem(sessionKey(session.id), JSON.stringify(session))
  rememberCurrentSession(session.id)
  return session
}
