/**
 * Shared constants — single source of truth for all magic strings.
 * Import from here instead of hardcoding throughout the codebase.
 */

// Auth / Session
export const SESSION_COOKIE = 'claos_session'
export const UI_CONTROL_ENABLED_KEY = 'claos_ui_control_enabled'

// LocalStorage keys
export const LS_KEYS = {
  SPEECH_LANG: 'speech-lang',
  DEFAULT_UI_AGENT: 'ui-control-default-agent-id',
  SESSIONS: 'claos:sessions',
  MESSAGES_PREFIX: 'claos:msgs:',
  SELECTED_SESSION: 'claos:selected',
  GROUPS_PREFIX: 'claos:group:',
} as const

// Session key prefixes
export const SESSION_PREFIX = {
  CLAOS: 'claos-',
  MULTIAGENT: 'claos-multiagent-',
  UI_CONTROL: 'ui-control-',
} as const

// API timeouts (ms)
export const TIMEOUTS = {
  CHAT_STREAM: 130_000,
  GATEWAY_PROBE: 5_000,
  STREAM_GLOBAL: 180_000, // Global chat stream max (3 min)
  STREAM_RESPONSE: 30_000, // Per-response timeout within a stream
  PING_INTERVAL: 15_000, // SSE keepalive ping interval
  AGENT_TASK: 60_000, // Per-agent task timeout in group runs
  AGENT_CACHE_TTL: 30_000, // Agent/gateway discovery cache TTL
} as const

// Rate limiting
export const RATE_LIMITS = {
  AUTH_MAX_ATTEMPTS: 5,
  AUTH_LOCKOUT_MS: 15 * 60 * 1000,
  // Max concurrent terminal sessions - configurable via TERMINAL_MAX_SESSIONS env
  // Default: 20 (no practical limit for personal use)
  TERMINAL_MAX_SESSIONS: parseInt(process.env.TERMINAL_MAX_SESSIONS || '20', 10),
} as const
