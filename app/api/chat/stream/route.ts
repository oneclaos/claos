import { NextRequest } from 'next/server'
import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { getGatewayClient, GatewayError } from '@/lib/gateway/chat-client'
import { randomBytes } from 'crypto'

/** True when the error is caused by the client disconnecting (not a real error). */
function isClientAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return (
    msg.includes('bodystreambuffer was aborted') ||
    msg.includes('aborted') ||
    msg.includes('connection reset') ||
    msg.includes('premature close')
  )
}

function getClientInfo(request: NextRequest) {
  return {
    ip:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown',
  }
}

// POST /api/chat/stream - Stream chat response via SSE
export async function POST(request: NextRequest) {
  const { ip, userAgent } = getClientInfo(request)

  const token = await getSessionFromCookies()
  if (!token || !validateSession(token, ip, userAgent)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    return new Response('Invalid CSRF token', { status: 403 })
  }

  interface Attachment {
    content: string
    mimeType?: string
    fileName?: string
  }

  let body: {
    gatewayId: string
    sessionKey: string
    message: string
    attachments?: Attachment[]
    idempotencyKey?: string
  }

  // Read body as text first for debugging
  const rawBody = await request.text()
  try {
    body = JSON.parse(rawBody)
  } catch (jsonErr) {
    console.error('[chat/stream] JSON parse failed:', {
      error: jsonErr instanceof Error ? jsonErr.message : String(jsonErr),
      rawBodyPreview: rawBody.slice(0, 500),
      rawBodyLength: rawBody.length,
      contentType: request.headers.get('content-type'),
    })
    return new Response('Invalid JSON', { status: 400 })
  }

  const { gatewayId, sessionKey, message, attachments, idempotencyKey: clientIdempotencyKey } = body

  // Debug: log every request to track 400 issues
  console.log('[chat/stream] Request received:', {
    gatewayId: gatewayId ?? '(undefined)',
    sessionKey: sessionKey ?? '(undefined)',
    messageLength: message?.length ?? 0,
    hasAttachments: !!attachments?.length,
  })

  if (!gatewayId || !message) {
    console.error('[chat/stream] MISSING REQUIRED FIELDS:', {
      gatewayId: gatewayId ?? '(undefined)',
      gatewayIdType: typeof gatewayId,
      message: message ? `${message.slice(0, 50)}...` : '(undefined)',
      messageType: typeof message,
      sessionKey,
      fullBody: JSON.stringify(body).slice(0, 500),
    })
    return new Response(
      JSON.stringify({
        error: 'Missing gatewayId or message',
        detail: !gatewayId
          ? 'gatewayId is missing - group session may need to be recreated'
          : 'message is empty',
        debug: { gatewayId: !!gatewayId, message: !!message },
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const encoder = new TextEncoder()
  const abortSignal = request.signal

  const stream = new ReadableStream({
    async start(controller) {
      let completed = false
      let fullText = ''
      let activeRunId: string | null = null
      let pingInterval: NodeJS.Timeout | null = null
      let outerTimeout: NodeJS.Timeout | null = null
      let gatewayClient: Awaited<ReturnType<typeof getGatewayClient>> | null = null
      let agentListener: ((payload: unknown) => void) | null = null

      const cleanup = () => {
        if (pingInterval) {
          clearInterval(pingInterval)
          pingInterval = null
        }
        if (outerTimeout) {
          clearTimeout(outerTimeout)
          outerTimeout = null
        }
        if (gatewayClient && agentListener) {
          gatewayClient.off('agent', agentListener)
          agentListener = null
        }
      }

      const safeClose = () => {
        cleanup()
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      const safeSend = (data: string) => {
        if (abortSignal.aborted) return
        try {
          controller.enqueue(encoder.encode(data))
        } catch {
          /* stream closed */
        }
      }

      // Clean up if browser disconnects mid-stream
      abortSignal.addEventListener(
        'abort',
        () => {
          completed = true
          cleanup()
        },
        { once: true }
      )

      try {
        const client = await getGatewayClient(gatewayId)
        gatewayClient = client
        // Use client-provided idempotency key for retry support (gateway deduplicates)
        const idempotencyKey =
          clientIdempotencyKey ?? `web-${Date.now()}-${randomBytes(8).toString('hex')}`

        if (abortSignal.aborted) return

        // Confirm connection to client
        safeSend(`: connected\n\n`)

        // Keepalive ping every 15s to prevent nginx/browser from closing idle SSE
        pingInterval = setInterval(() => {
          if (!completed) safeSend(`: ping\n\n`)
        }, 15000)

        // Flag to track when our message has been sent — prevents capturing runIds from other sessions
        let messageSent = false

        // Listen for agent events — filter by runId once we know it
        const onAgentEvent = (payload: {
          runId?: string
          stream?: string
          data?: { delta?: string; phase?: string }
        }) => {
          if (completed) return

          const { runId, stream: streamType, data } = payload

          // CRITICAL: Only capture runId AFTER we've sent our message
          // This prevents capturing runIds from other sessions (e.g., WhatsApp)
          if (runId && !activeRunId && messageSent) {
            activeRunId = runId
          }

          // Ignore events from other runs OR events before our message was sent
          if (!messageSent) return
          if (runId && activeRunId && runId !== activeRunId) return

          if (streamType === 'assistant' && data?.delta) {
            fullText += data.delta
            safeSend(`data: ${JSON.stringify({ type: 'delta', text: data.delta })}\n\n`)
          }

          if (streamType === 'lifecycle' && data?.phase === 'end') {
            completed = true
            safeSend(`data: ${JSON.stringify({ type: 'done', text: fullText })}\n\n`)
            client.off('agent', onAgentEvent)
            safeClose()
          }
        }

        agentListener = onAgentEvent as (payload: unknown) => void
        client.on('agent', onAgentEvent)

        // Global timeout — 3 minutes max
        outerTimeout = setTimeout(() => {
          if (!completed) {
            completed = true
            client.off('agent', onAgentEvent)
            if (fullText) {
              safeSend(`data: ${JSON.stringify({ type: 'done', text: fullText })}\n\n`)
            } else {
              safeSend(
                `data: ${JSON.stringify({ type: 'error', error: 'Response timeout — agent took too long' })}\n\n`
              )
            }
            safeClose()
          }
        }, 180000)

        // Send the message — 30s ACK timeout
        try {
          const sendResponse = await client.request<{ runId?: string }>(
            'chat.send',
            {
              sessionKey: sessionKey || 'claos-web',
              message,
              idempotencyKey,
              ...(attachments && attachments.length > 0 ? { attachments } : {}),
            },
            30000
          )

          // Mark message as sent — now we can start capturing events
          messageSent = true

          // If gateway returned a runId, use it immediately for filtering
          if (sendResponse?.runId) {
            activeRunId = sendResponse.runId
          }
        } catch (err) {
          // Silently ignore client-disconnect errors (stream already gone)
          if (isClientAbortError(err)) {
            safeClose()
            return
          }
          const gwErr = err instanceof GatewayError ? err : null
          const isTimeout =
            gwErr?.code === 'gateway.request_timeout' ||
            (err instanceof Error && err.message.toLowerCase().includes('timeout'))
          // On ACK timeout: agent events might still be flowing — keep stream open
          if (!completed && !isTimeout) {
            completed = true
            client.off('agent', onAgentEvent)
            safeSend(
              `data: ${JSON.stringify({
                type: 'error',
                error: gwErr ? gwErr.message : err instanceof Error ? err.message : 'Unknown error',
                code: gwErr?.code ?? 'gateway.request_failed',
                retryable: gwErr?.retryable ?? false,
              })}\n\n`
            )
            safeClose()
          }
        }
      } catch (err) {
        // Silently ignore client-disconnect errors (stream already gone)
        if (isClientAbortError(err)) {
          safeClose()
          return
        }
        const gwErr = err instanceof GatewayError ? err : null
        safeSend(
          `data: ${JSON.stringify({
            type: 'error',
            error: gwErr ? gwErr.message : err instanceof Error ? err.message : 'Connection failed',
            code: gwErr?.code ?? 'gateway.unknown',
            retryable: gwErr?.retryable ?? false,
          })}\n\n`
        )
        safeClose()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Transfer-Encoding': 'chunked',
    },
  })
}
