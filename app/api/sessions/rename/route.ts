import { log } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import fs from 'fs/promises'
import path from 'path'

const schema = z.object({
  sessionKey: z.string().min(1).max(255),
  name: z.string()
    .min(1, 'Name cannot be empty')
    .max(100, 'Name must be less than 100 characters')
    .regex(/^[\w\s\-]+$/, 'Name can only contain letters, numbers, spaces, and hyphens')
})

const NAMES_FILE = path.join(process.cwd(), 'data', 'session-names.json')

export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    // Validate input
    const result = schema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0]?.message || 'Invalid input' },
        { status: 400 }
      )
    }
    
    const { sessionKey, name } = result.data
    
    // Ensure data directory exists
    const dataDir = path.dirname(NAMES_FILE)
    await fs.mkdir(dataDir, { recursive: true })
    
    // Read existing names
    let names: Record<string, string> = {}
    try {
      const data = await fs.readFile(NAMES_FILE, 'utf-8')
      names = JSON.parse(data)
    } catch {
      // File doesn't exist yet, start with empty object
    }
    
    // Update
    names[sessionKey] = name
    
    // Write atomically (write to temp, then rename)
    const tmpFile = `${NAMES_FILE}.${Date.now()}.tmp`
    await fs.writeFile(tmpFile, JSON.stringify(names, null, 2))
    await fs.rename(tmpFile, NAMES_FILE)
    
    return NextResponse.json({ success: true })
  } catch (err) {
    log.error('Rename session error:', { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json(
      { error: 'Failed to rename session' },
      { status: 500 }
    )
  }
}
