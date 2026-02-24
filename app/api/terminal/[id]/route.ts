import { NextRequest, NextResponse } from "next/server"
import { getSessionFromCookies, validateSession, validateCsrfToken } from "@/lib/auth"
import { auditLog } from "@/lib/audit"
import { ptyManager } from "@/lib/terminal/pty-manager"
import { getClientInfo } from "@/lib/get-client-info"

type RouteContext = { params: Promise<{ id: string }> }

// DELETE /api/terminal/[id] - Close terminal session
export async function DELETE(request: NextRequest, context: RouteContext) {
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

  const destroyed = ptyManager.destroySession(id)
  
  if (!destroyed) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  auditLog("terminal", "closed", { ip, sessionId: id })
  return NextResponse.json({ success: true })
}
