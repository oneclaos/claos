// Agent discovery and management

import type { GatewayConfig, Agent } from './types'
import { discoverGateways, getGateways } from './discovery'
import { checkGatewayHealth } from './http-client'

/**
 * Get available agents from discovered gateways
 */
export async function getAvailableAgents(): Promise<Agent[]> {
  const gateways = await discoverGateways()
  
  return gateways.map(gw => ({
    id: gw.id,
    name: gw.name,
    gatewayId: gw.id,
    description: `Chat with ${gw.name}`,
    avatar: getAgentEmoji(gw.name),
    port: gw.port
  }))
}

/**
 * List gateways with online status
 */
export async function listGatewaysWithStatus(): Promise<Array<GatewayConfig & { online: boolean }>> {
  const gateways = await discoverGateways()
  
  return gateways.map(gw => ({
    ...gw,
    online: true // If discovered, it's online
  }))
}

/**
 * Check if a specific gateway is healthy
 */
export async function isGatewayHealthy(gatewayId: string): Promise<boolean> {
  const gateways = getGateways()
  const gateway = gateways.find(g => g.id === gatewayId)
  
  if (!gateway) return false
  
  return checkGatewayHealth(gateway)
}

/**
 * Get emoji avatar for agent based on name
 */
function getAgentEmoji(name: string): string {
  const nameLower = name.toLowerCase()
  const emojis: Record<string, string> = {
    james: '💰',
    hunter: '🎯',
    moltbot: '🔥',
    clawdio: '🎭',
    max: '🧠',
    openclaw: '🦞',
    cursor: '📝',
    claude: '🧩',
    assistant: '🤖'
  }
  
  for (const [key, emoji] of Object.entries(emojis)) {
    if (nameLower.includes(key)) return emoji
  }
  
  return '💬'
}
