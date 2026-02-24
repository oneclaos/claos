// Gateway types - shared across modules

export type GatewayType = 'clawdbot' | 'openclaw' | 'auto'

export interface GatewayConfig {
  id: string
  name: string
  url: string
  token?: string
  port?: number
  /**
   * Gateway protocol variant.
   * - 'clawdbot'  → client.id='cli', no explicit scopes required
   * - 'openclaw'  → client.id='openclaw-control-ui', scopes must be declared
   * - 'auto'      → probe both on first connect, persist detected type
   * Defaults to 'auto' when omitted.
   */
  type?: GatewayType
}

export interface CircuitBreakerState {
  failures: number
  lastFailure: number
  isOpen: boolean
}

export interface Agent {
  id: string
  name: string
  gatewayId: string
  description: string
  avatar: string
  port?: number
}

export interface WebSocketMessage {
  type: 'req' | 'res' | 'event'
  id?: string
  method?: string
  params?: Record<string, unknown>
  ok?: boolean
  payload?: unknown
  error?: string
  event?: string
  seq?: number
}

export interface ConnectParams {
  minProtocol: number
  maxProtocol: number
  client: {
    id: string
    displayName?: string
    version: string
    platform: string
    mode: string
  }
  role: string
  scopes: string[]
  auth?: { token: string }
  nonce?: string | null
}

export const CIRCUIT_BREAKER_THRESHOLD = 5
export const CIRCUIT_BREAKER_RESET_MS = 60000
export const DISCOVERY_CACHE_TTL = 30000
// Default port range for gateway discovery (covers common Clawdbot setups)
// Can be overridden via GATEWAY_PORT_START and GATEWAY_PORT_END env vars
export const DEFAULT_PORT_START = 18700
export const DEFAULT_PORT_END = 18850 // 150 ports — covers extended multi-agent setups
