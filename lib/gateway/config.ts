// Custom gateway persistence in ~/.claos/config.json
// Manages user-added VPS gateways that persist across restarts
// Tokens are encrypted at rest with AES-256-GCM (keyed from hostname + stored salt)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto'
import type { GatewayConfig } from './types'

const DATA_DIR = process.env.DATA_DIR || join(process.env.HOME || '/tmp', '.claos')
const CONFIG_FILE = join(DATA_DIR, 'config.json')

// Prefix that marks a token as AES-256-GCM encrypted
const ENC_PREFIX = 'enc:'

interface AppConfig {
  passwordHash?: string
  csrfSecret?: string
  customGateways?: StoredGatewayConfig[]
  /** Random salt used to derive the encryption key (hex string, 32 bytes) */
  encSalt?: string
  /** Random 32-byte AES master key (hex string) — generated once, never derived from hostname */
  encKey?: string
}

/** GatewayConfig as stored on disk — token may be plaintext (legacy) or enc:… */
interface StoredGatewayConfig extends Omit<GatewayConfig, 'token'> {
  token?: string
}

// ─── Encryption helpers ───────────────────────────────────────────────────────

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  }
}

function loadConfig(): AppConfig {
  if (!existsSync(CONFIG_FILE)) return {}
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function saveConfig(config: AppConfig): void {
  ensureDataDir()
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  })
}

/** Returns the 32-byte hex salt stored in config.json, creating it if absent. */
function getOrCreateSalt(): string {
  const config = loadConfig()
  if (config.encSalt) return config.encSalt
  const salt = randomBytes(32).toString('hex')
  saveConfig({ ...config, encSalt: salt })
  return salt
}

/**
 * Returns the 32-byte encryption master key.
 * Stored in config.json as `encKey` (generated once, never derived from hostname).
 * Hostname-derived keys break when the machine is renamed or cloned.
 */
function getEncryptionKey(): Buffer {
  const config = loadConfig()
  // Legacy: if encKey already stored, use it
  if (config.encKey) return Buffer.from(config.encKey, 'hex')
  // Generate a cryptographically random 32-byte key and persist it
  const key = randomBytes(32)
  saveConfig({ ...config, encKey: key.toString('hex') })
  return key
}

/**
 * Encrypts a token string.
 * Returns "enc:<iv_hex>:<tag_hex>:<ciphertext_hex>".
 */
function encryptToken(token: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ENC_PREFIX + [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':')
}

/**
 * Decrypts a token that was produced by encryptToken.
 * Passes through plain-text tokens (migration from pre-encryption state).
 */
function decryptToken(storedToken: string): string {
  if (!storedToken.startsWith(ENC_PREFIX)) {
    // Legacy plain-text token — return as-is (transparent migration)
    return storedToken
  }
  const payload = storedToken.slice(ENC_PREFIX.length)
  const [ivHex, tagHex, dataHex] = payload.split(':')
  const key = getEncryptionKey()
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return (
    decipher.update(Buffer.from(dataHex, 'hex')).toString('utf8') + decipher.final('utf8')
  )
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns all custom gateways with tokens decrypted. */
export function getCustomGateways(): GatewayConfig[] {
  const config = loadConfig()
  return (config.customGateways ?? []).map((gw) => ({
    ...gw,
    token: gw.token ? decryptToken(gw.token) : undefined,
  }))
}

/** Adds a new gateway — token is encrypted before writing to disk. */
export function addCustomGateway(gw: GatewayConfig): void {
  const config = loadConfig()
  const gateways = config.customGateways ?? []
  // Prevent duplicate IDs
  if (gateways.some((g) => g.id === gw.id)) {
    throw new Error(`Gateway with id "${gw.id}" already exists`)
  }
  const storedGw: StoredGatewayConfig = {
    ...gw,
    token: gw.token ? encryptToken(gw.token) : undefined,
  }
  gateways.push(storedGw)
  saveConfig({ ...config, customGateways: gateways })
}

/** Removes a gateway by ID. */
export function removeCustomGateway(id: string): void {
  const config = loadConfig()
  const gateways = (config.customGateways ?? []).filter((g) => g.id !== id)
  saveConfig({ ...config, customGateways: gateways })
}

/**
 * Updates an existing gateway.
 * If `patch.token` is provided, it is encrypted before writing.
 */
export function updateCustomGateway(id: string, patch: Partial<GatewayConfig>): void {
  const config = loadConfig()
  const gateways = config.customGateways ?? []
  const idx = gateways.findIndex((g) => g.id === id)
  if (idx === -1) throw new Error(`Gateway "${id}" not found`)

  const encryptedPatch: Partial<StoredGatewayConfig> = {
    ...patch,
    token: patch.token ? encryptToken(patch.token) : gateways[idx].token,
  }
  gateways[idx] = { ...gateways[idx], ...encryptedPatch, id } // id is immutable
  saveConfig({ ...config, customGateways: gateways })
}
