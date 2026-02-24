import { NextRequest } from 'next/server'
import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { sendGroupMessageStream, getGroup } from '@/lib/groups'
import { validateRequest, groupMessageRequestSchema } from '@/lib/validation'
import { auditLog } from '@/lib/audit'
import { log } from '@/lib/logger'
import { TIMEOUTS } from '@/lib/constants'

interface RouteParams {
  params: Promise<{ id: string }>
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

// POST /api/groups/[id]/stream - Stream group agent responses via SSE
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { ip, userAgent } = getClientInfo(request)

  const token = await getSessionFromCookies()
  if (!token || !validateSession(token, ip, userAgent)) {
    return new Response('Unauthorized', { status: 401 })
  }

  // CSRF validation
  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    auditLog('security', 'csrf_violation', { ip, action: 'group_stream' }, 'warn')
    return new Response('Invalid CSRF token', { status: 403 })
  }

  let body: { message: string }
  try {
    body = await request.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { id: groupId } = await params

  // Validate with groupId from URL
  const validation = validateRequest(groupMessageRequestSchema, {
    ...body,
    groupId,
  })

  if (!validation.success) {
    return new Response(validation.error, { status: 400 })
  }

  const group = getGroup(groupId)
  if (!group) {
    return new Response('Group not found', { status: 404 })
  }

  const encoder = new TextEncoder()
  const abortSignal = request.signal

  const stream = new ReadableStream({
    async start(controller) {
      let completed = false
      let pingInterval: NodeJS.Timeout | null = null
      let globalTimeout: NodeJS.Timeout | null = null

      const cleanup = () => {
        if (pingInterval) {
          clearInterval(pingInterval)
          pingInterval = null
        }
        if (globalTimeout) {
          clearTimeout(globalTimeout)
          globalTimeout = null
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
        if (abortSignal.aborted || completed) return
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
        // Confirm connection
        safeSend(`: connected\n\n`)

        // Keepalive ping every 15s
        pingInterval = setInterval(() => {
          if (!completed) safeSend(`: ping\n\n`)
        }, TIMEOUTS.PING_INTERVAL)

        // Global timeout - 2.5 minutes max (slightly more than backend timeout)
        globalTimeout = setTimeout(() => {
          if (!completed) {
            completed = true
            safeSend(
              `data: ${JSON.stringify({
                type: 'error',
                error: 'Global timeout - some agents took too long',
              })}\n\n`
            )
            safeClose()
          }
        }, 150000)

        // Send start event
        safeSend(
          `data: ${JSON.stringify({
            type: 'start',
            groupId,
            message: validation.data.message,
            agentCount: group.agents.length,
          })}\n\n`
        )

        // Stream responses from each agent
        const message = await sendGroupMessageStream(
          groupId,
          validation.data.message,
          (agentResponse) => {
            if (completed || abortSignal.aborted) return
            safeSend(
              `data: ${JSON.stringify({
                type: 'response',
                ...agentResponse,
              })}\n\n`
            )
          }
        )

        // Send done event with full message
        if (!completed && !abortSignal.aborted) {
          completed = true
          safeSend(
            `data: ${JSON.stringify({
              type: 'done',
              message,
            })}\n\n`
          )
          safeClose()
        }
      } catch (err) {
        if (!completed) {
          completed = true
          // Log full error server-side, return generic message (no info leak)
          log.error('Group stream error:', {
            ip,
            error: err instanceof Error ? err.message : String(err),
          })
          auditLog('group', 'stream_error', { ip }, 'error')
          safeSend(
            `data: ${JSON.stringify({
              type: 'error',
              error: 'Stream error occurred',
            })}\n\n`
          )
          safeClose()
        }
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
