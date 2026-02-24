/**
 * IndexedDB Storage Layer for Claos
 *
 * Handles all persistent storage:
 * - Sessions
 * - Messages (per session)
 * - Groups
 * - UI state
 */

const DB_NAME = 'claos'
const DB_VERSION = 1

// Store names
const STORES = {
  SESSIONS: 'sessions',
  MESSAGES: 'messages',
  GROUPS: 'groups',
  STATE: 'state',
} as const

type StoreName = (typeof STORES)[keyof typeof STORES]

// ============================================
// Database Initialization
// ============================================

let dbPromise: Promise<IDBDatabase> | null = null

function getDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB not available in SSR'))
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => {
        console.error('[IndexedDB] Failed to open database:', request.error)
        reject(request.error)
      }

      request.onsuccess = () => {
        resolve(request.result)
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Sessions store - keyed by gateway:sessionKey
        if (!db.objectStoreNames.contains(STORES.SESSIONS)) {
          const sessionsStore = db.createObjectStore(STORES.SESSIONS, { keyPath: 'id' })
          sessionsStore.createIndex('gateway', 'gateway', { unique: false })
          sessionsStore.createIndex('sessionKey', 'sessionKey', { unique: false })
          sessionsStore.createIndex('isGroup', 'isGroup', { unique: false })
        }

        // Messages store - keyed by sessionKey, stores array of messages
        if (!db.objectStoreNames.contains(STORES.MESSAGES)) {
          db.createObjectStore(STORES.MESSAGES, { keyPath: 'sessionKey' })
        }

        // Groups store - keyed by sessionKey
        if (!db.objectStoreNames.contains(STORES.GROUPS)) {
          const groupsStore = db.createObjectStore(STORES.GROUPS, { keyPath: 'sessionKey' })
          groupsStore.createIndex('createdAt', 'createdAt', { unique: false })
        }

        // State store - key-value for misc state (lastSession, hiddenSessions, etc.)
        if (!db.objectStoreNames.contains(STORES.STATE)) {
          db.createObjectStore(STORES.STATE, { keyPath: 'key' })
        }

        console.log('[IndexedDB] Database schema created/upgraded')
      }
    })
  }

  return dbPromise
}

// ============================================
// Generic CRUD Operations
// ============================================

async function dbGet<T>(storeName: StoreName, key: string): Promise<T | null> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const request = store.get(key)

    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error)
  })
}

async function dbPut<T>(storeName: StoreName, value: T): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const request = store.put(value)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function dbDelete(storeName: StoreName, key: string): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const request = store.delete(key)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function dbGetAll<T>(storeName: StoreName): Promise<T[]> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const request = store.getAll()

    request.onsuccess = () => resolve(request.result ?? [])
    request.onerror = () => reject(request.error)
  })
}

async function dbClear(storeName: StoreName): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const request = store.clear()

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

// ============================================
// Sessions API
// ============================================

export interface StoredSession {
  id: string // gateway:sessionKey
  gateway: string
  sessionKey: string
  gatewayName: string
  gatewayIds?: string[]
  kind?: string
  customName?: string | null
  label?: string
  lastActive?: string
  isGroup: boolean
  createdAt: number
}

export async function saveSession(session: StoredSession): Promise<void> {
  await dbPut(STORES.SESSIONS, session)
}

export async function getSession(
  gateway: string,
  sessionKey: string
): Promise<StoredSession | null> {
  return dbGet(STORES.SESSIONS, `${gateway}:${sessionKey}`)
}

export async function getAllSessions(): Promise<StoredSession[]> {
  return dbGetAll(STORES.SESSIONS)
}

export async function deleteSession(gateway: string, sessionKey: string): Promise<void> {
  await dbDelete(STORES.SESSIONS, `${gateway}:${sessionKey}`)
}

export async function getDirectSessions(): Promise<StoredSession[]> {
  const all = await getAllSessions()
  return all.filter((s) => !s.isGroup)
}

export async function getGroupSessions(): Promise<StoredSession[]> {
  const all = await getAllSessions()
  return all.filter((s) => s.isGroup)
}

// ============================================
// Messages API
// ============================================

export interface StoredMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
  requestId?: string // ID de requête pour filtrage
  attachments?: Array<{
    type: 'image' | 'audio' | 'text'
    name: string
    preview?: string
    mimeType?: string
  }>
  error?: boolean
  errorCode?: string
  retryable?: boolean
}

export interface StoredMessages {
  sessionKey: string
  messages: StoredMessage[]
  updatedAt: number
}

export async function saveMessages(sessionKey: string, messages: StoredMessage[]): Promise<void> {
  await dbPut(STORES.MESSAGES, {
    sessionKey,
    messages,
    updatedAt: Date.now(),
  })
}

export async function getMessages(sessionKey: string): Promise<StoredMessage[]> {
  const stored = await dbGet<StoredMessages>(STORES.MESSAGES, sessionKey)
  return stored?.messages ?? []
}

export async function deleteMessages(sessionKey: string): Promise<void> {
  await dbDelete(STORES.MESSAGES, sessionKey)
}

export async function appendMessage(sessionKey: string, message: StoredMessage): Promise<void> {
  const existing = await getMessages(sessionKey)
  existing.push(message)
  await saveMessages(sessionKey, existing)
}

// ============================================
// Groups API
// ============================================

export interface StoredGroup {
  sessionKey: string
  gatewayIds: string[]
  customName?: string
  createdAt: number
}

export async function saveGroup(group: StoredGroup): Promise<void> {
  await dbPut(STORES.GROUPS, group)
}

export async function getGroup(sessionKey: string): Promise<StoredGroup | null> {
  return dbGet(STORES.GROUPS, sessionKey)
}

export async function getAllGroups(): Promise<StoredGroup[]> {
  return dbGetAll(STORES.GROUPS)
}

export async function deleteGroup(sessionKey: string): Promise<void> {
  await dbDelete(STORES.GROUPS, sessionKey)
}

// ============================================
// State API (key-value store)
// ============================================

interface StateEntry {
  key: string
  value: unknown
  updatedAt: number
}

export async function setState<T>(key: string, value: T): Promise<void> {
  await dbPut(STORES.STATE, {
    key,
    value,
    updatedAt: Date.now(),
  })
}

export async function getState<T>(key: string): Promise<T | null> {
  const entry = await dbGet<StateEntry>(STORES.STATE, key)
  return (entry?.value as T) ?? null
}

export async function deleteState(key: string): Promise<void> {
  await dbDelete(STORES.STATE, key)
}

// Specific state helpers
export async function getLastSession(): Promise<StoredSession | null> {
  return getState<StoredSession>('lastSession')
}

export async function setLastSession(session: StoredSession | null): Promise<void> {
  if (session) {
    await setState('lastSession', session)
  } else {
    await deleteState('lastSession')
  }
}

export async function getHiddenSessions(): Promise<string[]> {
  return (await getState<string[]>('hiddenSessions')) ?? []
}

export async function setHiddenSessions(hidden: string[]): Promise<void> {
  await setState('hiddenSessions', hidden)
}

export async function addHiddenSession(id: string): Promise<void> {
  const hidden = await getHiddenSessions()
  if (!hidden.includes(id)) {
    hidden.push(id)
    await setHiddenSessions(hidden)
  }
}

// ============================================
// Migration from localStorage
// ============================================

export async function migrateFromLocalStorage(): Promise<void> {
  if (typeof window === 'undefined') return

  const migrated = await getState<boolean>('migratedFromLocalStorage')
  if (migrated) return

  console.log('[IndexedDB] Starting migration from localStorage...')

  try {
    // Migrate sessions
    const sessionsRaw = localStorage.getItem('claos:sessions')
    if (sessionsRaw) {
      const sessions = JSON.parse(sessionsRaw)
      if (Array.isArray(sessions)) {
        for (const s of sessions) {
          const isGroup = s.sessionKey?.startsWith('claos-multiagent-') || s.kind === 'group'
          await saveSession({
            id: `${s.gateway}:${s.sessionKey}`,
            gateway: s.gateway,
            sessionKey: s.sessionKey,
            gatewayName: s.gatewayName,
            gatewayIds: s.gatewayIds,
            kind: s.kind,
            customName: s.customName,
            label: s.label,
            lastActive: s.lastActive,
            isGroup,
            createdAt: Date.now(),
          })
        }
        console.log(`[IndexedDB] Migrated ${sessions.length} sessions`)
      }
    }

    // Migrate groups
    const groupsRaw = localStorage.getItem('claos:groups')
    if (groupsRaw) {
      const groups = JSON.parse(groupsRaw)
      if (Array.isArray(groups)) {
        for (const g of groups) {
          if (g.sessionKey && Array.isArray(g.gatewayIds)) {
            await saveGroup({
              sessionKey: g.sessionKey,
              gatewayIds: g.gatewayIds,
              customName: g.customName,
              createdAt: Date.now(),
            })
          }
        }
        console.log(`[IndexedDB] Migrated ${groups.length} groups`)
      }
    }

    // Migrate messages (scan for claos:msgs:* keys)
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('claos:msgs:')) {
        const sessionKey = key.replace('claos:msgs:', '')
        const msgsRaw = localStorage.getItem(key)
        if (msgsRaw) {
          try {
            const msgs = JSON.parse(msgsRaw)
            if (Array.isArray(msgs)) {
              await saveMessages(sessionKey, msgs)
            }
          } catch {
            /* ignore invalid */
          }
        }
      }
    }

    // Migrate last session
    const lastSessionRaw = localStorage.getItem('claos:lastSession')
    if (lastSessionRaw) {
      try {
        const lastSession = JSON.parse(lastSessionRaw)
        if (lastSession?.sessionKey) {
          const isGroup =
            lastSession.sessionKey.startsWith('claos-multiagent-') ||
            lastSession.kind === 'group'
          await setLastSession({
            id: `${lastSession.gateway}:${lastSession.sessionKey}`,
            gateway: lastSession.gateway,
            sessionKey: lastSession.sessionKey,
            gatewayName: lastSession.gatewayName,
            gatewayIds: lastSession.gatewayIds,
            kind: lastSession.kind,
            customName: lastSession.customName,
            isGroup,
            createdAt: Date.now(),
          })
        }
      } catch {
        /* ignore */
      }
    }

    // Migrate hidden sessions
    const hiddenRaw = localStorage.getItem('claos_hidden_sessions')
    if (hiddenRaw) {
      try {
        const hidden = JSON.parse(hiddenRaw)
        if (Array.isArray(hidden)) {
          await setHiddenSessions(hidden)
        }
      } catch {
        /* ignore */
      }
    }

    // Mark migration complete
    await setState('migratedFromLocalStorage', true)
    console.log('[IndexedDB] Migration complete!')
  } catch (err) {
    console.error('[IndexedDB] Migration failed:', err)
  }
}

// ============================================
// Initialize
// ============================================

export async function initStorage(): Promise<void> {
  await getDB()
  await migrateFromLocalStorage()
}
