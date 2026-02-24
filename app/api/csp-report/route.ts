import { log } from '@/lib/logger'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    log.error('[CSP Violation]', { body: JSON.stringify(body) })
  } catch {
    // Malformed report body — ignore
  }
  return new Response(null, { status: 204 })
}
