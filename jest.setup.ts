import '@testing-library/jest-dom'
import { existsSync, mkdirSync, rmSync } from 'fs'

// Mock environment variables for tests
process.env.DATA_DIR = '/tmp/claos-test-data'
process.env.CLAOS_PASSWORD_HASH =
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyWDYJNdwE3u' // "password"
process.env.CSRF_SECRET =
  'test_secret_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
process.env.GATEWAYS = JSON.stringify([
  {
    id: 'test-gateway',
    name: 'Test Gateway',
    url: 'http://localhost:18789',
    token: 'test-token',
  },
])

// Clean up test data directory before/after tests
beforeAll(() => {
  const testDataDir = process.env.DATA_DIR!

  if (existsSync(testDataDir)) {
    rmSync(testDataDir, { recursive: true, force: true })
  }
  mkdirSync(testDataDir, { recursive: true })
})

afterAll(() => {
  const testDataDir = process.env.DATA_DIR!

  if (existsSync(testDataDir)) {
    rmSync(testDataDir, { recursive: true, force: true })
  }
})

// Mock next/headers
jest.mock('next/headers', () => ({
  cookies: jest.fn(() => ({
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}))

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
  useSearchParams: jest.fn(),
}))
