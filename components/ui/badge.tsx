import { cn } from '@/lib/utils'

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info'

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] border border-[var(--color-border)]',
  success: 'bg-[oklch(0.55_0.18_150_/_0.1)] text-[var(--color-success)] border border-[oklch(0.55_0.18_150_/_0.2)]',
  warning: 'bg-[oklch(0.65_0.16_80_/_0.1)] text-[var(--color-warning)] border border-[oklch(0.65_0.16_80_/_0.2)]',
  error:   'bg-[oklch(0.55_0.22_25_/_0.1)] text-[var(--color-error)] border border-[oklch(0.55_0.22_25_/_0.2)]',
  info:    'bg-[oklch(0.55_0.15_250_/_0.1)] text-[var(--color-info)] border border-[oklch(0.55_0.15_250_/_0.2)]',
}

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none',
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
