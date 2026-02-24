// Jest test setup

// Mock environment variables
process.env.DATA_DIR = '/tmp/claos-test-data'
process.env.CLAOS_PASSWORD_HASH =
  '$2b$12$KOPPklH5DocA6Jzaif2EFOvKDDzAng9ZLDBawU5d.xeVCGNkJcwEK'
process.env.CSRF_SECRET = 'test-csrf-secret-for-testing-only-do-not-use-in-production'
;(process.env as { NODE_ENV: string }).NODE_ENV = 'test'

// Clean up test data before each test
import { rmSync, mkdirSync, existsSync } from 'fs'

beforeEach(() => {
  const testDir = process.env.DATA_DIR!
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true })
  }
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  const testDir = process.env.DATA_DIR!
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true })
  }
})
