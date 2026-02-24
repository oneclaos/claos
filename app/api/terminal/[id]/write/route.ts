import { NextRequest, NextResponse } from "next/server"
import { getSessionFromCookies, validateSession, validateCsrfToken } from "@/lib/auth"
import { ptyManager } from "@/lib/terminal/pty-manager"
import { z } from "zod"

const writeSchema = z.object({
  data: z.string().max(10000)
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

// POST /api/terminal/[id]/write - Send input to terminal
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
    const result = writeSchema.safeParse(body)
    
    if (!result.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 })
    }

    const written = ptyManager.write(id, result.data.data)
    
    if (!written) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed to write" }, { status: 500 })
  }
}
