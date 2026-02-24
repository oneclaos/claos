import { cookies } from 'next/headers'
import { randomBytes, createHash, timingSafeEqual } from 'crypto'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import bcrypt from 'bcrypt'
import writeFileAtomic from 'write-file-atomic'
import { SESSION_COOKIE } from './constants'
import { log } from './logger'

// ============================================
// Configuration
// ============================================
const SESSION_EXPIRY_MS = 4 * 60 * 60 * 1000 // 4 hours
const BCRYPT_ROUNDS = 12
const DATA_DIR = process.env.DATA_DIR || join(process.env.HOME || '/tmp', '.claos')
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json')

// Warn if DATA_DIR is in /tmp (data will be lost on reboot)
if (DATA_DIR.startsWith('/tmp')) {
  log.warn('DATA_DIR is in /tmp — data will be lost on reboot. Set DATA_DIR in .env.local')
}

// ============================================
// Session Storage (File-based, persistent)
// ============================================

interface SessionData {
  expiresAt: number
  ip: string
  userAgent: string
  createdAt: number
}

interface SessionStore {
  [token: string]: SessionData
}

// Ensure data directory exists
function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  }
}

// ── In-memory cache for sessions (avoids blocking readFileSync on every request) ──
// Cache TTL: 5 s.  Invalidated immediately on every write so writes are always fresh.
interface SessionsCache {
  data: SessionStore
  loadedAt: number
}
let sessionsCache: SessionsCache | null = null
const SESSIONS_CACHE_TTL_MS = 5_000

function invalidateSessionsCache(): void {
  sessionsCache = null
}

// Load sessions from file — returns from cache when fresh
function loadSessions(): SessionStore {
  ensureDataDir()
  if (sessionsCache && Date.now() - sessionsCache.loadedAt < SESSIONS_CACHE_TTL_MS) {
    return sessionsCache.data
  }
  if (!existsSync(SESSIONS_FILE)) {
    const empty: SessionStore = {}
    sessionsCache = { data: empty, loadedAt: Date.now() }
    return empty
  }
  try {
    const data = readFileSync(SESSIONS_FILE, 'utf-8')
    const parsed: SessionStore = JSON.parse(data)
    sessionsCache = { data: parsed, loadedAt: Date.now() }
    return parsed
  } catch {
    const empty: SessionStore = {}
    sessionsCache = { data: empty, loadedAt: Date.now() }
    return empty
  }
}

// Save sessions to file — invalidates cache, then writes atomically to prevent race conditions
function saveSessions(sessions: SessionStore): void {
  ensureDataDir()
  // Invalidate cache immediately so subsequent reads see fresh data
  sessionsCache = { data: sessions, loadedAt: Date.now() }
  // Atomic write prevents race conditions and partial writes
  writeFileAtomic(SESSIONS_FILE, JSON.stringify(sessions, null, 2), { mode: 0o600 }).catch(
    (err: Error) => log.error('Failed to persist sessions:', { error: err.message })
  )
}

// Clean expired sessions
function cleanExpiredSessions(sessions: SessionStore): SessionStore {
  const now = Date.now()
  const cleaned: SessionStore = {}
  for (const [token, data] of Object.entries(sessions)) {
    if (data.expiresAt > now) {
      cleaned[token] = data
    }
  }
  return cleaned
}

// ============================================
// Password Hashing (bcrypt)
// ============================================

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

// Dummy hash for constant-time comparison when no valid hash exists
// This ensures timing-safe behavior even when the hash is missing/invalid
// (prevents timing attacks from revealing whether an account exists)
const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4D3qJ1T7m9p3FNWe'

export async function verifyPassword(input: string, storedHash: string): Promise<boolean> {
  // Always perform a bcrypt comparison for constant-time behavior
  // Use dummy hash if stored hash is missing/invalid to prevent timing attacks
  const hashToCompare = storedHash && storedHash.startsWith('$2') ? storedHash : DUMMY_HASH

  try {
    const result = await bcrypt.compare(input, hashToCompare)
    // Only return true if we used the real hash (not the dummy)
    return result && hashToCompare === storedHash
  } catch {
    // Catch any bcrypt errors (malformed hash, etc.)
    // Still timing-safe because we already did a bcrypt.compare above
    return false
  }
}

// ============================================
// Session Management
// ============================================

export function createSession(ip: string, userAgent: string): string {
  const sessions = cleanExpiredSessions(loadSessions())
  const token = randomBytes(32).toString('hex')

  sessions[token] = {
    expiresAt: Date.now() + SESSION_EXPIRY_MS,
    ip,
    userAgent: userAgent.slice(0, 500), // Limit UA length
    createdAt: Date.now(),
  }

  saveSessions(sessions)
  return token
}

export function validateSession(token: string, ip?: string, userAgent?: string): boolean {
  if (!token || token.length !== 64) return false

  const sessions = loadSessions()
  const session = sessions[token]

  if (!session) return false
  if (session.expiresAt < Date.now()) {
    // Clean up expired session
    delete sessions[token]
    saveSessions(sessions)
    return false
  }

  // Optional: Validate IP and User-Agent match (configurable)
  if (process.env.STRICT_SESSION_BINDING === 'true') {
    if (ip && session.ip !== ip) return false
    if (userAgent && session.userAgent !== userAgent.slice(0, 500)) return false
  }

  return true
}

export function deleteSession(token: string): void {
  const sessions = loadSessions()
  delete sessions[token]
  saveSessions(sessions)
}

export function rotateSession(oldToken: string, ip: string, userAgent: string): string {
  // Delete old session and create new one (session rotation)
  deleteSession(oldToken)
  return createSession(ip, userAgent)
}

export function getSessionInfo(token: string): SessionData | null {
  const sessions = loadSessions()
  return sessions[token] || null
}

// ============================================
// Cookie Management
// ============================================

export async function getSessionFromCookies(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(SESSION_COOKIE)?.value || null
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_EXPIRY_MS / 1000,
    path: '/',
  })
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}

// ============================================
// Password Hash Management
// ============================================

const CONFIG_FILE = join(DATA_DIR, 'config.json')

interface AppConfig {
  passwordHash?: string
  csrfSecret?: string
}

// ── In-memory cache for config (avoids blocking readFileSync on every request) ──
// Cache TTL: 30 s — config changes rarely; invalidated immediately on every write.
interface ConfigCache {
  data: AppConfig
  loadedAt: number
}
let configCache: ConfigCache | null = null
const CONFIG_CACHE_TTL_MS = 30_000

function invalidateConfigCache(): void {
  configCache = null
}

function loadAppConfig(): AppConfig {
  if (configCache && Date.now() - configCache.loadedAt < CONFIG_CACHE_TTL_MS) {
    return configCache.data
  }
  if (!existsSync(CONFIG_FILE)) {
    const empty: AppConfig = {}
    configCache = { data: empty, loadedAt: Date.now() }
    return empty
  }
  try {
    const data: AppConfig = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    configCache = { data, loadedAt: Date.now() }
    return data
  } catch {
    const empty: AppConfig = {}
    configCache = { data: empty, loadedAt: Date.now() }
    return empty
  }
}

function saveAppConfig(config: AppConfig): void {
  ensureDataDir()
  // Atomic write prevents race conditions and partial writes
  writeFileAtomic.sync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 })
  // Update cache immediately so subsequent reads reflect the new config without a disk round-trip
  configCache = { data: config, loadedAt: Date.now() }
}

// Get the password hash from config file or env (config takes precedence)
export function getPasswordHash(): string {
  // First check config file (allows password changes without restart)
  const config = loadAppConfig()
  if (config.passwordHash) {
    return config.passwordHash
  }

  // Fall back to env var
  const hash = process.env.CLAOS_PASSWORD_HASH
  if (!hash) {
    throw new Error('CLAOS_PASSWORD_HASH not configured')
  }
  return hash
}

// Returns true when no password has been configured yet (first-run state)
export function isFirstRun(): boolean {
  const config = loadAppConfig()
  if (config.passwordHash) return false
  if (process.env.CLAOS_PASSWORD_HASH) return false
  return true
}

// Save password hash to config file (used by first-run wizard)
export async function setPasswordHash(password: string): Promise<void> {
  const hash = await hashPassword(password)
  const config = loadAppConfig()
  saveAppConfig({ ...config, passwordHash: hash })
}

// ============================================
// CSRF Token Management
// ============================================

function loadOrCreateCsrfSecret(): string {
  if (process.env.CSRF_SECRET) return process.env.CSRF_SECRET

  ensureDataDir()
  const config = loadAppConfig()
  if (config.csrfSecret) return config.csrfSecret

  const secret = randomBytes(32).toString('hex')
  saveAppConfig({ ...config, csrfSecret: secret })
  log.info('CSRF secret generated and persisted to data directory')
  return secret
}

const CSRF_SECRET = loadOrCreateCsrfSecret()

export function generateCsrfToken(sessionToken: string): string {
  const timestamp = Date.now().toString(36)
  const data = `${sessionToken}:${timestamp}`
  // 48 hex chars = 24 bytes = 192 bits — meets OWASP minimum (128 bits)
  const signature = createHash('sha256').update(`${data}:${CSRF_SECRET}`).digest('hex').slice(0, 48)
  return `${timestamp}.${signature}`
}

export function validateCsrfToken(csrfToken: string, sessionToken: string): boolean {
  if (!csrfToken || !sessionToken) return false

  const parts = csrfToken.split('.')
  if (parts.length !== 2) return false

  const [timestamp, signature] = parts
  const tokenAge = Date.now() - parseInt(timestamp, 36)

  // Token expires after 4 hours
  if (tokenAge > 4 * 60 * 60 * 1000) return false

  // Verify signature (48 hex chars = 24 bytes)
  const data = `${sessionToken}:${timestamp}`
  const expectedSignature = createHash('sha256')
    .update(`${data}:${CSRF_SECRET}`)
    .digest('hex')
    .slice(0, 48)

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  } catch {
    return false
  }
}

// ============================================
// Rate Limiting (File-based, persistent)
// ============================================

const RATE_LIMIT_FILE = join(DATA_DIR, 'rate-limits.json')

interface RateLimitData {
  count: number
  lockedUntil: number
  lastAttempt: number
}

interface RateLimitStore {
  [ip: string]: RateLimitData
}

// Small in-memory cache for rate limits (reduces I/O on repeated login attempts)
let rateLimitsCache: { data: RateLimitStore; loadedAt: number } | null = null
const RATE_LIMITS_CACHE_TTL_MS = 2_000 // 2 s — short to keep lockout responsive

function loadRateLimits(): RateLimitStore {
  ensureDataDir()
  if (rateLimitsCache && Date.now() - rateLimitsCache.loadedAt < RATE_LIMITS_CACHE_TTL_MS) {
    return rateLimitsCache.data
  }
  if (!existsSync(RATE_LIMIT_FILE)) {
    const empty: RateLimitStore = {}
    rateLimitsCache = { data: empty, loadedAt: Date.now() }
    return empty
  }
  try {
    const data = readFileSync(RATE_LIMIT_FILE, 'utf-8')
    const parsed: RateLimitStore = JSON.parse(data)
    rateLimitsCache = { data: parsed, loadedAt: Date.now() }
    return parsed
  } catch {
    const empty: RateLimitStore = {}
    rateLimitsCache = { data: empty, loadedAt: Date.now() }
    return empty
  }
}

function saveRateLimits(limits: RateLimitStore): void {
  ensureDataDir()
  // Clean old entries (older than 1 hour)
  const now = Date.now()
  const cleaned: RateLimitStore = {}
  for (const [ip, data] of Object.entries(limits)) {
    if (now - data.lastAttempt < 60 * 60 * 1000) {
      cleaned[ip] = data
    }
  }
  // Update cache immediately before async write
  rateLimitsCache = { data: cleaned, loadedAt: Date.now() }
  // Atomic write prevents race conditions and partial writes
  writeFileAtomic(RATE_LIMIT_FILE, JSON.stringify(cleaned, null, 2), { mode: 0o600 }).catch(
    (err: Error) => log.error('Failed to persist rate-limits:', { error: err.message })
  )
}

export function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const limits = loadRateLimits()
  const record = limits[ip]
  const now = Date.now()

  if (record) {
    if (record.lockedUntil > now) {
      return { allowed: false, retryAfter: Math.ceil((record.lockedUntil - now) / 1000) }
    }
    if (record.count >= 20) {
      record.lockedUntil = now + 2 * 60 * 1000 // 2 min lockout (dev-friendly)
      saveRateLimits(limits)
      return { allowed: false, retryAfter: 900 }
    }
  }

  return { allowed: true }
}

export function recordLoginAttempt(ip: string, success: boolean): void {
  const limits = loadRateLimits()

  if (success) {
    delete limits[ip]
  } else {
    const record = limits[ip] || { count: 0, lockedUntil: 0, lastAttempt: 0 }
    record.count++
    record.lastAttempt = Date.now()
    limits[ip] = record
  }

  saveRateLimits(limits)
}
