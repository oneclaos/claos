/**
 * Structured Gateway Error Codes
 *
 * Replaces generic Error strings with typed codes so the UI can show
 * meaningful messages and the retry logic can make smart decisions.
 */

export type GatewayErrorCode =
  | 'gateway.not_found'       // Gateway ID not in registry
  | 'gateway.url_missing'     // No URL configured for this gateway
  | 'gateway.token_invalid'   // Auth rejected by gateway (bad token)
  | 'gateway.unreachable'     // Connection refused / network error
  | 'gateway.timeout'         // Connection timed out
  | 'gateway.not_ready'       // WS connected but handshake incomplete
  | 'gateway.disconnected'    // Was connected, now disconnected
  | 'gateway.circuit_open'    // Circuit breaker tripped (too many failures)
  | 'gateway.request_failed'  // Request sent but gateway returned an error
  | 'gateway.request_timeout' // Request timed out after being sent
  | 'gateway.unknown'         // Catch-all for unexpected errors

/** Human-readable messages for each code */
export const GATEWAY_ERROR_MESSAGES: Record<GatewayErrorCode, string> = {
  'gateway.not_found':       'Agent not found. It may have been removed.',
  'gateway.url_missing':     'No gateway URL configured.',
  'gateway.token_invalid':   'Invalid gateway token. Check your credentials.',
  'gateway.unreachable':     'Cannot reach the gateway. Is Clawdbot running?',
  'gateway.timeout':         'Connection timed out. The gateway may be slow or offline.',
  'gateway.not_ready':       'Gateway connection is not ready yet. Try again.',
  'gateway.disconnected':    'Gateway disconnected. Reconnecting…',
  'gateway.circuit_open':    'Gateway is temporarily unavailable after repeated failures.',
  'gateway.request_failed':  'The gateway returned an error.',
  'gateway.request_timeout': 'Request timed out. The agent may be busy.',
  'gateway.unknown':         'An unexpected gateway error occurred.',
}

/** Whether this error is worth auto-retrying (vs surfacing to the user) */
export const GATEWAY_ERROR_RETRYABLE: Record<GatewayErrorCode, boolean> = {
  'gateway.not_found':       false,
  'gateway.url_missing':     false,
  'gateway.token_invalid':   false,
  'gateway.unreachable':     true,
  'gateway.timeout':         true,
  'gateway.not_ready':       true,
  'gateway.disconnected':    true,
  'gateway.circuit_open':    false,
  'gateway.request_failed':  false,
  'gateway.request_timeout': true,
  'gateway.unknown':         false,
}

export class GatewayError extends Error {
  readonly code: GatewayErrorCode
  readonly retryable: boolean

  constructor(code: GatewayErrorCode, detail?: string) {
    const base = GATEWAY_ERROR_MESSAGES[code]
    super(detail ? `${base} (${detail})` : base)
    this.name = 'GatewayError'
    this.code = code
    this.retryable = GATEWAY_ERROR_RETRYABLE[code]
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    }
  }
}

/**
 * Wraps any error into a GatewayError with the best matching code.
 * Use this at boundaries where raw errors cross into our code.
 */
export function toGatewayError(err: unknown, fallbackCode: GatewayErrorCode = 'gateway.unknown'): GatewayError {
  if (err instanceof GatewayError) return err

  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()

  if (msg.includes('gateway not found') || msg.includes('not found:')) {
    return new GatewayError('gateway.not_found', err instanceof Error ? err.message : undefined)
  }
  if (msg.includes('circuit open') || msg.includes('circuit breaker')) {
    return new GatewayError('gateway.circuit_open')
  }
  if (msg.includes('invalid token') || msg.includes('unauthorized') || msg.includes('401') || msg.includes('auth')) {
    return new GatewayError('gateway.token_invalid')
  }
  if (msg.includes('econnrefused') || msg.includes('connection refused') || msg.includes('enotfound') || msg.includes('unreachable')) {
    return new GatewayError('gateway.unreachable')
  }
  if (msg.includes('timeout') && msg.includes('connect')) {
    return new GatewayError('gateway.timeout')
  }
  if (msg.includes('request timeout') || msg.includes('timed out')) {
    return new GatewayError('gateway.request_timeout')
  }
  if (msg.includes('not ready') || msg.includes('gateway not ready')) {
    return new GatewayError('gateway.not_ready')
  }
  if (msg.includes('disconnected') || msg.includes('connection closed') || msg.includes('closed')) {
    return new GatewayError('gateway.disconnected')
  }

  return new GatewayError(fallbackCode, err instanceof Error ? err.message : String(err))
}
