import { NextRequest } from "next/server"
import { getSessionFromCookies, validateSession } from "@/lib/auth"
import { ptyManager } from "@/lib/terminal/pty-manager"

function getClientInfo(request: NextRequest) {
  return {
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() 
      || request.headers.get("x-real-ip") 
      || "unknown",
    userAgent: request.headers.get("user-agent") || "unknown"
  }
}

type RouteContext = { params: Promise<{ id: string }> }

// GET /api/terminal/[id]/stream - SSE stream of terminal output
export async function GET(request: NextRequest, context: RouteContext) {
  const { ip, userAgent } = getClientInfo(request)
  const { id } = await context.params
  
  const token = await getSessionFromCookies()
  if (!token || !validateSession(token, ip, userAgent)) {
    return new Response("Unauthorized", { status: 401 })
  }

  const session = ptyManager.getSession(id)
  if (!session) {
    return new Response("Session not found", { status: 404 })
  }

  const encoder = new TextEncoder()
  
  const stream = new ReadableStream({
    start(controller) {
      // Send initial ping to confirm connection
      controller.enqueue(encoder.encode(`: ping\n\n`))
      
      const onData = (data: string) => {
        // SSE format: data: <content>\n\n (base64 encoded)
        const encoded = Buffer.from(data).toString("base64")
        controller.enqueue(encoder.encode(`data: ${encoded}\n\n`))
      }

      const onExit = (exitCode: number) => {
        controller.enqueue(encoder.encode(`event: exit\ndata: ${exitCode}\n\n`))
        controller.close()
      }

      session.emitter.on("data", onData)
      session.emitter.on("exit", onExit)

      // Cleanup on close
      request.signal.addEventListener("abort", () => {
        session.emitter.off("data", onData)
        session.emitter.off("exit", onExit)
      })
    }
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    }
  })
}
