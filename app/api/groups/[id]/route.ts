import { log } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession } from '@/lib/auth'
import { getGroup, getGroupMessages } from '@/lib/groups'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/groups/[id] - Get group details and messages
export async function GET(_request: Request, { params }: RouteParams) {
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const group = getGroup(id)
    
    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    const messages = getGroupMessages(id)
    
    return NextResponse.json({ group, messages })
  } catch (err) {
    log.error('Failed to get group:', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Failed to get group' }, { status: 500 })
  }
}
