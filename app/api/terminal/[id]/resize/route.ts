import { NextRequest, NextResponse } from "next/server"
import { getSessionFromCookies, validateSession, validateCsrfToken } from "@/lib/auth"
import { ptyManager } from "@/lib/terminal/pty-manager"
import { z } from "zod"

const resizeSchema = z.object({
  cols: z.number().int().min(10).max(500),
  rows: z.number().int().min(5).max(200)
})

function getClientInfo(request: NextRequest) {
  return {
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() 
      || request.headers.get("x-real-ip") 
      || "unknown",
    userAgent: request.headers.get("user-agent") || "unknown"
  }
}

type RouteContext = { params: Promise<{ id: string }> }

// POST /api/terminal/[id]/resize - Resize terminal
export async function POST(request: NextRequest, context: RouteContext) {
  const { ip, userAgent } = getClientInfo(request)
  const { id } = await context.params
  
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token, ip, userAgent)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const csrfToken = request.headers.get("x-csrf-token")
  if (!csrfToken || !validateCsrfToken(csrfToken, token)) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 })
  }

  try {
    const body = await request.json()
    const result = resizeSchema.safeParse(body)
    
    if (!result.success) {
      return NextResponse.json({ error: "Invalid dimensions" }, { status: 400 })
    }

    const resized = ptyManager.resize(id, result.data.cols, result.data.rows)
    
    if (!resized) {
      // Session already gone (race: terminal deleted before ResizeObserver fires) — not an error
      return NextResponse.json({ success: true }, { status: 200 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed to resize" }, { status: 500 })
  }
}
