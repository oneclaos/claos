// Shared session helper functions

import type { Session, Gateway } from '@/lib/types'

// ─── Session display name ─────────────────────────────────────────────────────
// Priority: customName > label (cleaned, for groups) > gatewayIds joined > gatewayName > sessionKey
export const sessionDisplayName = (session: Session): string => {
  if (session.customName) return session.customName

  // For group sessions: use the actual group name from label
  const isGroup = session.sessionKey.startsWith('claos-multiagent-')
  if (isGroup && session.label && session.label !== session.sessionKey) {
    const cleaned = session.label
      .replace(/^(telegram|whatsapp|signal|discord):g?-?/, '')
      .replace(/-/g, ' ')
      .trim()
    if (cleaned) return cleaned
  }

  // For group sessions without customName/label: fall back to gatewayIds list
  // (prevents showing a single agent name like "James" for a multi-agent group)
  if (isGroup && session.gatewayIds && session.gatewayIds.length > 1) {
    return session.gatewayIds.join(' + ')
  }

  // For direct sessions: agent name (gatewayName)
  if (session.gatewayName) return session.gatewayName
  return session.sessionKey
}

// ─── Explicit group session detection ─────────────────────────────────────────
// Check BOTH sessionKey prefix AND kind to ensure consistent classification.
// This must match the isGroupKey logic in useSessionLoader.ts
export const isGroupSession = (s: Session) =>
  s.sessionKey.startsWith('claos-multiagent-') || s.kind === 'group'

// ─── Parse group messages (extract "**AgentName**: " prefix) ─────────────────
export const parseGroupMessage = (content: string): { agent: string | null; text: string } => {
  const match = content.match(/^\*\*([^*]+)\*\*:\s*([\s\S]*)$/)
  if (match) return { agent: match[1], text: match[2] }
  return { agent: null, text: content }
}

// ─── Gateway display helpers ──────────────────────────────────────────────────
export const gwDisplayName = (gw: Gateway) => gw.name
export const gwPortLabel = (gw: Gateway) => (gw.port ? `:${gw.port}` : null)

// ─── Session timestamp helpers ────────────────────────────────────────────────
/** Extract a sortable epoch timestamp from a session's lastActive or sessionKey. */
export const getSessionTimestamp = (s: Session): number => {
  if (s.lastActive) return new Date(s.lastActive).getTime()
  const match = s.sessionKey.match(/-(\d{10,})$/)
  return match ? parseInt(match[1]) : 0
}

/**
 * Deduplicate a session list by keyFn.
 *
 * When multiple sessions share the same key, `pickerFn` is called with all
 * candidates to choose the winner. Defaults to most-recent by timestamp.
 */
export const deduplicateForDisplay = (
  list: Session[],
  keyFn: (s: Session) => string,
  pickerFn?: (candidates: Session[]) => Session
): Session[] => {
  const buckets = new Map<string, Session[]>()
  for (const s of list) {
    const key = keyFn(s)
    const bucket = buckets.get(key) ?? []
    bucket.push(s)
    buckets.set(key, bucket)
  }
  const result: Session[] = []
  for (const [, candidates] of buckets) {
    if (pickerFn) {
      result.push(pickerFn(candidates))
    } else {
      result.push(
        candidates.reduce((best, s) =>
          getSessionTimestamp(s) > getSessionTimestamp(best) ? s : best
        )
      )
    }
  }
  return result
}
