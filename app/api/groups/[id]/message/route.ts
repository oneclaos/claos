import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { sendGroupMessage, getGroup } from '@/lib/groups'
import { validateRequest, groupMessageRequestSchema } from '@/lib/validation'
import { auditLog } from '@/lib/audit'

interface RouteParams {
  params: Promise<{ id: string }>
}

function getClientInfo(request: NextRequest) {
  return {
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
      || request.headers.get('x-real-ip') 
      || 'unknown'
  }
}

// POST /api/groups/[id]/message - Send message to all agents in group
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { ip } = getClientInfo(request)
  
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // CSRF validation
  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    auditLog('security', 'csrf_violation', { ip, action: 'group_message' }, 'warn')
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  try {
    const { id: groupId } = await params
    const body = await request.json()
    
    // Validate with groupId from URL
    const validation = validateRequest(groupMessageRequestSchema, {
      ...body,
      groupId
    })
    
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const group = getGroup(groupId)
    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    const message = await sendGroupMessage(groupId, validation.data.message)
    
    return NextResponse.json({ message })
  } catch (err) {
    auditLog('group', 'message_error', { ip, error: String(err) }, 'error')
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
