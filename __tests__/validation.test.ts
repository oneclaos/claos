// Tests for validation schemas

import { 
  validateRequest,
  safePathSchema,
  gatewayIdSchema,
  messageContentSchema,
  sendMessageRequestSchema,
  createGroupRequestSchema,
  ALLOWED_BASE_PATHS
} from '@/lib/validation'

describe('Validation Schemas', () => {
  
  describe('safePathSchema', () => {
    it('should accept valid paths within allowed directories', () => {
      const result = safePathSchema.safeParse('/home/clawd/clawd/test.txt')
      expect(result.success).toBe(true)
    })

    it('should reject paths with traversal attempts', () => {
      const result = safePathSchema.safeParse('/home/clawd/clawd/../../../etc/passwd')
      expect(result.success).toBe(false)
    })

    it('should reject paths outside allowed directories', () => {
      const result = safePathSchema.safeParse('/etc/passwd')
      expect(result.success).toBe(false)
    })

    it('should reject paths with null bytes', () => {
      const result = safePathSchema.safeParse('/home/clawd/clawd/test\x00.txt')
      expect(result.success).toBe(false)
    })

    it('should reject paths that are too long', () => {
      const longPath = '/home/clawd/clawd/' + 'a'.repeat(500)
      const result = safePathSchema.safeParse(longPath)
      expect(result.success).toBe(false)
    })
  })

  describe('gatewayIdSchema', () => {
    it('should accept valid gateway IDs', () => {
      expect(gatewayIdSchema.safeParse('james').success).toBe(true)
      expect(gatewayIdSchema.safeParse('agent-1').success).toBe(true)
      expect(gatewayIdSchema.safeParse('agent_2').success).toBe(true)
    })

    it('should reject invalid gateway IDs', () => {
      expect(gatewayIdSchema.safeParse('').success).toBe(false)
      expect(gatewayIdSchema.safeParse('agent@bad').success).toBe(false)
      expect(gatewayIdSchema.safeParse('a'.repeat(60)).success).toBe(false)
    })
  })

  describe('messageContentSchema', () => {
    it('should accept valid messages', () => {
      expect(messageContentSchema.safeParse('Hello world').success).toBe(true)
    })

    it('should reject empty messages', () => {
      expect(messageContentSchema.safeParse('').success).toBe(false)
    })

    it('should reject messages that are too long', () => {
      const longMessage = 'a'.repeat(100001)
      expect(messageContentSchema.safeParse(longMessage).success).toBe(false)
    })
  })

  describe('sendMessageRequestSchema', () => {
    it('should accept valid send message request', () => {
      const result = sendMessageRequestSchema.safeParse({
        gatewayId: 'james',
        message: 'Hello',
        history: []
      })
      expect(result.success).toBe(true)
    })

    it('should use default empty history if not provided', () => {
      const result = sendMessageRequestSchema.safeParse({
        gatewayId: 'james',
        message: 'Hello'
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.history).toEqual([])
      }
    })

    it('should reject missing required fields', () => {
      expect(sendMessageRequestSchema.safeParse({}).success).toBe(false)
      expect(sendMessageRequestSchema.safeParse({ gatewayId: 'james' }).success).toBe(false)
      expect(sendMessageRequestSchema.safeParse({ message: 'Hello' }).success).toBe(false)
    })
  })

  describe('createGroupRequestSchema', () => {
    it('should accept valid group creation request', () => {
      const result = createGroupRequestSchema.safeParse({
        name: 'Test Group',
        agents: [{ id: 'james', gatewayId: 'james' }]
      })
      expect(result.success).toBe(true)
    })

    it('should reject groups without agents', () => {
      const result = createGroupRequestSchema.safeParse({
        name: 'Test Group',
        agents: []
      })
      expect(result.success).toBe(false)
    })

    it('should reject groups with too many agents', () => {
      const agents = Array(15).fill({ id: 'agent', gatewayId: 'gw' })
      const result = createGroupRequestSchema.safeParse({
        name: 'Test Group',
        agents
      })
      expect(result.success).toBe(false)
    })

    it('should reject invalid group names', () => {
      expect(createGroupRequestSchema.safeParse({
        name: 'Invalid<Name>',
        agents: [{ id: 'james', gatewayId: 'james' }]
      }).success).toBe(false)
    })
  })

  describe('validateRequest helper', () => {
    it('should return success with data for valid input', () => {
      const result = validateRequest(gatewayIdSchema, 'james')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe('james')
      }
    })

    it('should return error message for invalid input', () => {
      const result = validateRequest(gatewayIdSchema, '')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(typeof result.error).toBe('string')
      }
    })
  })
})
