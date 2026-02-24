/**
 * Test script for Gateway WebSocket client
 * Run: npx tsx scripts/test-gateway-ws.ts
 */

import { GatewayWsClient } from '../lib/gateway/ws-client'

async function main() {
  console.log('🔌 Testing Gateway WebSocket connection...\n')

  const client = new GatewayWsClient({
    url: 'ws://127.0.0.1:18789',
    token: 'd7aa74867c04c78c9ab05523b24a2aba19d6b80f3f9a3c68',
    onError: (err) => console.error('❌ Error:', err.message),
    onClose: (code, reason) => console.log(`🔴 Closed: ${code} - ${reason}`),
    onReady: () => console.log('✅ Gateway ready!'),
    onMessage: (event, payload) => console.log(`📨 Event: ${event}`, payload),
  })

  try {
    console.log('Connecting...')
    await client.connect()
    console.log('Connected and authenticated!\n')

    // Test: List sessions
    console.log('📋 Testing sessions.list...')
    const sessions = await client.request('sessions.list', { limit: 5 })
    console.log('Sessions:', JSON.stringify(sessions, null, 2).slice(0, 500))

    // Test: Get status
    console.log('\n📊 Testing status...')
    const status = await client.request('status')
    console.log('Status:', JSON.stringify(status, null, 2).slice(0, 500))

    console.log('\n✅ All tests passed!')
    
  } catch (err) {
    console.error('❌ Test failed:', err)
  } finally {
    client.close()
    process.exit(0)
  }
}

main()
