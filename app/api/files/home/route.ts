import { NextResponse } from 'next/server'
import { getSessionFromCookies, validateSession } from '@/lib/auth'
import { getDefaultHomePath } from '@/lib/validation'

// GET /api/files/home — returns the default home path for file browsing
export async function GET() {
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ path: getDefaultHomePath() })
}
