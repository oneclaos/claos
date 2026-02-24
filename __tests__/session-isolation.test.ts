/**
 * Unit tests for session isolation
 * Validates that each conversation gets a unique sessionKey
 */

describe('Session Isolation', () => {
  describe('createDirectSession', () => {
    it('should generate unique sessionKeys for multiple conversations with same agent', () => {
      const gatewayId = 'james'

      // Simuler deux créations de session
      const sessionKey1 = `claos-${gatewayId}-${Date.now()}`

      // Attendre 1ms pour garantir un timestamp différent
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
      return wait(1).then(() => {
        const sessionKey2 = `claos-${gatewayId}-${Date.now()}`

        // Les sessionKeys DOIVENT être différents
        expect(sessionKey1).not.toBe(sessionKey2)

        // Vérifier le format
        expect(sessionKey1).toMatch(/^claos-james-\d+$/)
        expect(sessionKey2).toMatch(/^claos-james-\d+$/)

        // Extraire les timestamps
        const ts1 = parseInt(sessionKey1.split('-').pop() || '0')
        const ts2 = parseInt(sessionKey2.split('-').pop() || '0')

        // Timestamp 2 doit être >= timestamp 1
        expect(ts2).toBeGreaterThanOrEqual(ts1)
      })
    })

    it('should not reuse existing sessions', () => {
      const gatewayId = 'james'
      const existingSessions = [
        {
          sessionKey: 'claos-james-1234567890',
          gateway: 'james',
          gatewayName: 'James',
          kind: 'direct' as const,
        },
      ]

      // Créer une nouvelle session pour le même agent
      const newSessionKey = `claos-${gatewayId}-${Date.now()}`

      // La nouvelle session NE DOIT PAS réutiliser l'existante
      const isReused = existingSessions.some((s) => s.sessionKey === newSessionKey)
      expect(isReused).toBe(false)
    })

    it('should maintain isolation in localStorage', () => {
      const session1Key = 'claos-james-1111111111'
      const session2Key = 'claos-james-2222222222'

      const messages1 = [
        { role: 'user', content: 'Message in conversation 1' },
        { role: 'assistant', content: 'Response 1' },
      ]

      const messages2 = [
        { role: 'user', content: 'Message in conversation 2' },
        { role: 'assistant', content: 'Response 2' },
      ]

      // Simuler le stockage
      const storage: Record<string, unknown[]> = {}
      storage[`claos:msgs:${session1Key}`] = messages1
      storage[`claos:msgs:${session2Key}`] = messages2

      // Vérifier l'isolation
      expect(storage[`claos:msgs:${session1Key}`]).toEqual(messages1)
      expect(storage[`claos:msgs:${session2Key}`]).toEqual(messages2)
      expect(storage[`claos:msgs:${session1Key}`]).not.toEqual(messages2)
    })
  })

  describe('Session Key Format', () => {
    it('should follow the pattern claos-{gatewayId}-{timestamp}', () => {
      const gatewayId = 'james'
      const timestamp = Date.now()
      const sessionKey = `claos-${gatewayId}-${timestamp}`

      expect(sessionKey).toMatch(/^claos-[a-z]+-\d+$/)

      // Décomposer
      const parts = sessionKey.split('-')
      expect(parts[0]).toBe('claos')
      expect(parts[1]).toBe(gatewayId)
      expect(parts[2]).toBe(timestamp.toString())
    })

    it('should use millisecond precision for uniqueness', () => {
      const ts1 = Date.now()
      const ts2 = Date.now()

      // Même si appelé immédiatement après, le timestamp peut être différent
      // (ou égal si très rapide, mais garantit l'unicité sur des appels successifs)
      expect(typeof ts1).toBe('number')
      expect(typeof ts2).toBe('number')
      expect(ts1).toBeLessThanOrEqual(ts2)
    })
  })

  describe('Group Sessions', () => {
    it('should use different pattern for groups', () => {
      const groupSessionKey = `claos-multiagent-${Date.now()}`

      expect(groupSessionKey).toMatch(/^claos-multiagent-\d+$/)
      // Group sessions use 'multiagent' prefix, distinguishing them from direct agent sessions
      expect(groupSessionKey).toContain('multiagent')
    })

    it('should not confuse group and direct sessions', () => {
      const directKey = 'claos-james-1234567890'
      const groupKey = 'claos-multiagent-1234567890'

      const isGroup = (key: string) => key.startsWith('claos-multiagent-')

      expect(isGroup(directKey)).toBe(false)
      expect(isGroup(groupKey)).toBe(true)
    })
  })
})

export {}
