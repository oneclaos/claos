/**
 * Tests for lib/utils.ts
 * Pure utility functions — no mocks needed
 */

import { cn, formatDate, formatRelativeTime, formatFileSize, truncate, generateId } from '@/lib/utils'

describe('cn (className merger)', () => {
  it('merges simple class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles undefined/null/false values', () => {
    expect(cn('foo', undefined, null as never, false, 'bar')).toBe('foo bar')
  })

  it('resolves Tailwind conflicts (last wins)', () => {
    const result = cn('text-red-500', 'text-blue-500')
    expect(result).toBe('text-blue-500')
  })

  it('handles empty input', () => {
    expect(cn()).toBe('')
  })

  it('handles conditional classes', () => {
    const isActive = true
    expect(cn('base', isActive && 'active')).toBe('base active')
  })
})

describe('formatDate', () => {
  it('formats a valid ISO date string', () => {
    const result = formatDate('2024-01-15T10:30:00.000Z')
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
  })

  it('formats a Date object', () => {
    const d = new Date('2024-06-01T12:00:00.000Z')
    const result = formatDate(d)
    expect(result).toBeTruthy()
    expect(result).not.toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(formatDate('')).toBe('')
  })

  it('returns empty string for invalid date', () => {
    expect(formatDate('not-a-date')).toBe('')
  })
})

describe('formatRelativeTime', () => {
  it('returns "Just now" for very recent timestamps', () => {
    const now = new Date()
    expect(formatRelativeTime(now)).toBe('Just now')
  })

  it('returns minutes ago for recent timestamps', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    expect(formatRelativeTime(fiveMinutesAgo)).toBe('5m ago')
  })

  it('returns hours ago for timestamps within 24 hours', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago')
  })

  it('returns days ago for timestamps within a week', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    expect(formatRelativeTime(threeDaysAgo)).toBe('3d ago')
  })

  it('returns formatted date for timestamps older than a week', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    const result = formatRelativeTime(twoWeeksAgo)
    expect(result).toBeTruthy()
    expect(result).not.toMatch(/ago/)
  })

  it('handles numeric timestamps', () => {
    const ts = Date.now() - 30 * 1000 // 30s ago
    expect(formatRelativeTime(ts)).toBe('Just now')
  })

  it('returns empty string for null/undefined', () => {
    expect(formatRelativeTime(null)).toBe('')
    expect(formatRelativeTime(undefined)).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(formatRelativeTime('')).toBe('')
  })
})

describe('formatFileSize', () => {
  it('returns "0 B" for 0 bytes', () => {
    expect(formatFileSize(0)).toBe('0 B')
  })

  it('formats bytes', () => {
    expect(formatFileSize(500)).toBe('500 B')
  })

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1 KB')
  })

  it('formats megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1 MB')
  })

  it('formats gigabytes', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB')
  })

  it('handles fractional sizes', () => {
    const result = formatFileSize(1536) // 1.5 KB
    expect(result).toBe('1.5 KB')
  })

  it('handles large numbers', () => {
    const result = formatFileSize(1024 * 1024 * 1024 * 2.5)
    expect(result).toBe('2.5 GB')
  })
})

describe('truncate', () => {
  it('returns string unchanged if within maxLength', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('truncates string with ellipsis if over maxLength', () => {
    expect(truncate('hello world', 8)).toBe('hello...')
  })

  it('returns string unchanged at exact length', () => {
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('handles empty string', () => {
    expect(truncate('', 10)).toBe('')
  })

  it('adds "..." for long strings', () => {
    const long = 'a'.repeat(100)
    const result = truncate(long, 10)
    expect(result).toHaveLength(10)
    expect(result.endsWith('...')).toBe(true)
  })
})

describe('generateId', () => {
  it('returns a non-empty string', () => {
    const id = generateId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()))
    expect(ids.size).toBe(100)
  })

  it('contains only alphanumeric characters', () => {
    const id = generateId()
    expect(id).toMatch(/^[a-z0-9]+$/)
  })
})
