'use client'

import { cn } from '@/lib/utils'

interface AvatarProps {
  name: string
  size?: 'sm' | 'md' | 'lg'
  isOnline?: boolean
  className?: string
}

/** Deterministic hue from name string */
function nameToHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash) % 360
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

const sizeMap = {
  sm: { outer: 'w-6 h-6', text: 'text-[9px]', dot: 'w-1.5 h-1.5 border' },
  md: { outer: 'w-8 h-8', text: 'text-[11px]', dot: 'w-2 h-2 border-[1.5px]' },
  lg: { outer: 'w-10 h-10', text: 'text-xs', dot: 'w-2.5 h-2.5 border-2' },
}

export function Avatar({ name, size = 'md', isOnline, className }: AvatarProps) {
  const hue = nameToHue(name)
  const initials = getInitials(name)
  const sizes = sizeMap[size]

  return (
    <div className={cn('relative flex-shrink-0', className)}>
      <div
        className={cn(
          'rounded-full flex items-center justify-center font-semibold select-none',
          sizes.outer,
          sizes.text
        )}
        style={{
          background: `oklch(0.80 0.10 ${hue})`,
          color: `oklch(0.25 0.08 ${hue})`,
        }}
      >
        {initials}
      </div>
      {isOnline !== undefined && (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full border-white',
            sizes.dot,
            isOnline ? 'bg-[var(--color-success)]' : 'bg-gray-300'
          )}
        />
      )}
    </div>
  )
}
