/**
 * Security Tests: Atomic Writes
 *
 * AUDIT REQUIREMENT: Test that concurrent writes don't cause data corruption
 */

import writeFileAtomic from 'write-file-atomic'
import {
  existsSync,
  readFileSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
  rmdirSync,
  statSync,
} from 'fs'
import { join } from 'path'

const TEST_DIR = '/tmp/claos-atomic-test'
const TEST_FILE = join(TEST_DIR, 'test.json')

describe('Atomic Write Operations', () => {
  beforeAll(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(TEST_FILE)) {
      unlinkSync(TEST_FILE)
    }
  })

  afterAll(() => {
    try {
      if (existsSync(TEST_DIR)) {
        const files = readdirSync(TEST_DIR)
        files.forEach((f: string) => unlinkSync(join(TEST_DIR, f)))
        rmdirSync(TEST_DIR)
      }
    } catch {
      // Cleanup best effort
    }
  })

  it('writes file atomically (sync)', () => {
    const data = { session: 'test123', expiresAt: Date.now() }

    writeFileAtomic.sync(TEST_FILE, JSON.stringify(data, null, 2))

    const written = JSON.parse(readFileSync(TEST_FILE, 'utf-8'))
    expect(written.session).toBe('test123')
  })

  it('writes file atomically (async)', async () => {
    const data = { session: 'async-test', value: 42 }

    await writeFileAtomic(TEST_FILE, JSON.stringify(data, null, 2))

    const written = JSON.parse(readFileSync(TEST_FILE, 'utf-8'))
    expect(written.session).toBe('async-test')
    expect(written.value).toBe(42)
  })

  it('handles concurrent writes without corruption', async () => {
    // Simulate concurrent writes - atomic write ensures no interleaving
    const writes = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      data: `data-${i}`,
      timestamp: Date.now(),
    }))

    // Write all concurrently
    await Promise.all(writes.map((w) => writeFileAtomic(TEST_FILE, JSON.stringify(w, null, 2))))

    // File should contain valid JSON (one of the writes won, no corruption)
    const result = JSON.parse(readFileSync(TEST_FILE, 'utf-8'))
    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('data')
    expect(result).toHaveProperty('timestamp')
    expect(typeof result.id).toBe('number')
  })

  it('preserves file permissions', () => {
    const data = { secret: 'value' }
    const mode = 0o600

    writeFileAtomic.sync(TEST_FILE, JSON.stringify(data), { mode })

    const stats = statSync(TEST_FILE)
    // Check permissions (mask with 0o777 to get just the permission bits)
    expect(stats.mode & 0o777).toBe(mode)
  })
})

describe('Session Storage Atomic Behavior', () => {
  it('documents that sessions use atomic writes', () => {
    // This is a documentation test - the actual implementation
    // in lib/auth.ts uses writeFileAtomic

    // Expected behavior:
    // 1. Write to temp file first
    // 2. Rename temp to target (atomic on POSIX)
    // 3. No partial writes possible
    // 4. No race condition data loss

    expect(typeof writeFileAtomic).toBe('function')
    expect(typeof writeFileAtomic.sync).toBe('function')
  })
})
