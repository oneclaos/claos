// Session Store - Abstraction layer for session storage
// Supports: File-based (default) or Redis (optional)

import { readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import writeFileAtomic from 'write-file-atomic'
import { log } from './logger'

// ============================================
// Configuration
// ============================================

const DATA_DIR = process.env.DATA_DIR || '/tmp/claos-data'
const REDIS_URL = process.env.REDIS_URL || ''
const SESSION_EXPIRY_MS = 4 * 60 * 60 * 1000 // 4 hours

// ============================================
// Types
// ============================================

export interface SessionData {
  expiresAt: number
  ip: string
  userAgent: string
  createdAt: number
}

interface SessionStore {
  get(token: string): Promise<SessionData | null>
  set(token: string, data: SessionData): Promise<void>
  delete(token: string): Promise<void>
  cleanup(): Promise<void>
}

// ============================================
// File-based Store (Default)
// ============================================

class FileSessionStore implements SessionStore {
  private readonly filePath: string

  constructor() {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
    }
    this.filePath = join(DATA_DIR, 'sessions.json')
  }

  private load(): Record<string, SessionData> {
    if (!existsSync(this.filePath)) {
      return {}
    }
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8'))
    } catch {
      return {}
    }
  }

  private save(sessions: Record<string, SessionData>): void {
    // Atomic write prevents race conditions and partial writes
    writeFileAtomic.sync(this.filePath, JSON.stringify(sessions, null, 2), { mode: 0o600 })
  }

  async get(token: string): Promise<SessionData | null> {
    const sessions = this.load()
    const session = sessions[token]
    if (!session) return null
    if (session.expiresAt < Date.now()) {
      delete sessions[token]
      this.save(sessions)
      return null
    }
    return session
  }

  async set(token: string, data: SessionData): Promise<void> {
    const sessions = this.load()
    sessions[token] = data
    this.save(sessions)
  }

  async delete(token: string): Promise<void> {
    const sessions = this.load()
    delete sessions[token]
    this.save(sessions)
  }

  async cleanup(): Promise<void> {
    const sessions = this.load()
    const now = Date.now()
    let changed = false
    for (const [token, data] of Object.entries(sessions)) {
      if (data.expiresAt < now) {
        delete sessions[token]
        changed = true
      }
    }
    if (changed) {
      this.save(sessions)
    }
  }
}

// ============================================
// Redis Store (Optional)
// ============================================

class RedisSessionStore implements SessionStore {
  private redis: import('ioredis').default | null = null
  private readonly prefix = 'claos:session:'

  constructor(redisUrl: string) {
    // Lazy init to avoid import issues if Redis not used
    this.initRedis(redisUrl)
  }

  private async initRedis(url: string) {
    try {
      const Redis = (await import('ioredis')).default
      this.redis = new Redis(url, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        retryStrategy: (times: number) => {
          if (times > 3) return null // Stop retrying
          return Math.min(times * 100, 3000) // Exponential backoff
        },
      })
      await this.redis.connect()
      log.info('Connected to Redis session store')
    } catch (err) {
      log.error('Redis connection failed, falling back to file store', {
        error: err instanceof Error ? err.message : String(err),
      })
      this.redis = null
    }
  }

  private async getRedis(): Promise<import('ioredis').default> {
    if (!this.redis) {
      throw new Error('Redis not available')
    }
    return this.redis
  }

  async get(token: string): Promise<SessionData | null> {
    try {
      const redis = await this.getRedis()
      const data = await redis.get(this.prefix + token)
      if (!data) return null
      return JSON.parse(data)
    } catch {
      return null
    }
  }

  async set(token: string, data: SessionData): Promise<void> {
    try {
      const redis = await this.getRedis()
      const ttl = Math.ceil((data.expiresAt - Date.now()) / 1000)
      if (ttl > 0) {
        await redis.setex(this.prefix + token, ttl, JSON.stringify(data))
      }
    } catch (err) {
      log.error('Redis set failed', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  async delete(token: string): Promise<void> {
    try {
      const redis = await this.getRedis()
      await redis.del(this.prefix + token)
    } catch (err) {
      log.error('Redis delete failed', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  async cleanup(): Promise<void> {
    // Redis handles TTL automatically
  }

  async isConnected(): Promise<boolean> {
    try {
      const redis = await this.getRedis()
      await redis.ping()
      return true
    } catch {
      return false
    }
  }
}

// ============================================
// Store Factory
// ============================================

let storeInstance: SessionStore | null = null

export function getSessionStore(): SessionStore {
  if (storeInstance) return storeInstance

  if (REDIS_URL) {
    log.info('Using Redis session store')
    storeInstance = new RedisSessionStore(REDIS_URL)
  } else {
    log.info('Using file-based session store')
    storeInstance = new FileSessionStore()
  }

  return storeInstance
}

// ============================================
// Session Helper Functions
// ============================================

export async function createSession(token: string, ip: string, userAgent: string): Promise<void> {
  const store = getSessionStore()
  await store.set(token, {
    expiresAt: Date.now() + SESSION_EXPIRY_MS,
    ip,
    userAgent: userAgent.slice(0, 500),
    createdAt: Date.now(),
  })
}

export async function validateSession(
  token: string,
  ip?: string,
  userAgent?: string
): Promise<boolean> {
  if (!token || token.length !== 64) return false

  const store = getSessionStore()
  const session = await store.get(token)

  if (!session) return false
  if (session.expiresAt < Date.now()) {
    await store.delete(token)
    return false
  }

  // Optional strict binding
  if (process.env.STRICT_SESSION_BINDING === 'true') {
    if (ip && session.ip !== ip) return false
    if (userAgent && session.userAgent !== userAgent.slice(0, 500)) return false
  }

  return true
}

export async function deleteSession(token: string): Promise<void> {
  const store = getSessionStore()
  await store.delete(token)
}

export async function getSessionInfo(token: string): Promise<SessionData | null> {
  const store = getSessionStore()
  return store.get(token)
}
