import { 
  isCircuitOpen, 
  recordFailure, 
  recordSuccess, 
  withRetry 
} from '@/lib/gateway/circuit-breaker'

describe('Circuit Breaker', () => {
  const testGatewayId = 'test-gateway'

  beforeEach(() => {
    // Suppress circuit-breaker warning noise in test output
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    // Reset state by recording multiple successes
    for (let i = 0; i < 10; i++) {
      recordSuccess(testGatewayId)
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('isCircuitOpen', () => {
    it('should return false for new gateway', () => {
      expect(isCircuitOpen('new-gateway')).toBe(false)
    })

    it('should return false after success', () => {
      recordSuccess(testGatewayId)
      expect(isCircuitOpen(testGatewayId)).toBe(false)
    })

    it('should return true after threshold failures', () => {
      for (let i = 0; i < 5; i++) {
        recordFailure(testGatewayId)
      }
      expect(isCircuitOpen(testGatewayId)).toBe(true)
    })
  })

  describe('recordSuccess', () => {
    it('should reset failure count', () => {
      recordFailure(testGatewayId)
      recordFailure(testGatewayId)
      recordSuccess(testGatewayId)
      
      // Should need 5 more failures to open
      for (let i = 0; i < 4; i++) {
        recordFailure(testGatewayId)
      }
      expect(isCircuitOpen(testGatewayId)).toBe(false)
    })
  })

  describe('withRetry', () => {
    it('should return result on success', async () => {
      const fn = jest.fn().mockResolvedValue('success')
      
      const result = await withRetry(fn, testGatewayId)
      
      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should retry on failure', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success')
      
      const result = await withRetry(fn, testGatewayId, 3)
      
      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('should throw after max retries', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('always fails'))
      
      await expect(withRetry(fn, testGatewayId, 2)).rejects.toThrow('always fails')
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('should not retry on 4xx errors', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('400 Bad Request'))
      
      await expect(withRetry(fn, testGatewayId, 3)).rejects.toThrow('400')
      expect(fn).toHaveBeenCalledTimes(1)
    })
  })
})
