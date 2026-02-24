import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession, validateCsrfToken } from '@/lib/auth'
import { createGroup, listGroups, deleteGroup } from '@/lib/groups'
import { validateRequest, createGroupRequestSchema } from '@/lib/validation'
import { auditLog } from '@/lib/audit'
import { getClientInfo } from '@/lib/get-client-info'


// GET /api/groups - List all groups
export async function GET() {
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const groups = listGroups()
    return NextResponse.json({ groups })
  } catch (err) {
    auditLog('group', 'list_error', { error: String(err) }, 'error')
    return NextResponse.json({ error: 'Failed to list groups' }, { status: 500 })
  }
}

// POST /api/groups - Create a new group
export async function POST(request: NextRequest) {
  const { ip } = getClientInfo(request)
  
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // CSRF validation
  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    auditLog('security', 'csrf_violation', { ip, action: 'group_create' }, 'warn')
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const validation = validateRequest(createGroupRequestSchema, body)
    
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { name, description, agents } = validation.data
    const group = createGroup(name, description, agents)
    
    return NextResponse.json({ group }, { status: 201 })
  } catch (err) {
    auditLog('group', 'create_error', { ip, error: String(err) }, 'error')
    return NextResponse.json({ error: 'Failed to create group' }, { status: 500 })
  }
}

// DELETE /api/groups - Delete a group
export async function DELETE(request: NextRequest) {
  const { ip } = getClientInfo(request)
  
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // CSRF validation
  const csrfToken = request.headers.get('x-csrf-token')
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    auditLog('security', 'csrf_violation', { ip, action: 'group_delete' }, 'warn')
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const groupId = searchParams.get('id')
    
    if (!groupId) {
      return NextResponse.json({ error: 'Group ID required' }, { status: 400 })
    }

    const deleted = deleteGroup(groupId)
    if (!deleted) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }
    
    return NextResponse.json({ success: true })
  } catch (err) {
    auditLog('group', 'delete_error', { ip, error: String(err) }, 'error')
    return NextResponse.json({ error: 'Failed to delete group' }, { status: 500 })
  }
}
