// Gateway module - main export

// Types
export type { GatewayConfig, GatewayType, Agent, WebSocketMessage } from './types'

// Discovery
export { discoverGateways, refreshGateways, getGateways } from './discovery'

// Circuit breaker
export { isCircuitOpen, recordFailure, recordSuccess, withRetry } from './circuit-breaker'

// HTTP client
export { callGateway, checkGatewayHealth, sendMessageHttp } from './http-client'

// Structured error codes
export { GatewayError, toGatewayError, GATEWAY_ERROR_MESSAGES, GATEWAY_ERROR_RETRYABLE } from './errors'
export type { GatewayErrorCode } from './errors'

// WebSocket client (class only — use getGatewayClient from chat-client for connections)
export { GatewayWsClient } from './ws-client'
export type { GatewayClientOptions } from './ws-client'

// Chat client (single connection pool)
export { 
  getGatewayClient,
  sendChatMessage, 
  listSessions as listGatewaySessions, 
  getSessionHistory as getGatewaySessionHistory,
  getGatewayStatus,
  parseGatewaysConfig 
} from './chat-client'

// Sessions
export { 
  listSessions, 
  listAllSessions, 
  getSessionHistory, 
  sendToSession, 
  sendMessage 
} from './sessions'
export type { Session, Message } from './sessions'

// Unified registry
export { getAllGateways, getCachedGateways } from './registry'

// Agents
export { getAvailableAgents, listGatewaysWithStatus, isGatewayHealthy } from './agents'
