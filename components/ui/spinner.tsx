import { cn } from '@/lib/utils'

interface SpinnerProps {
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8'
}

export function Spinner({ className, size = 'md' }: SpinnerProps) {
  return (
    <svg
      className={cn('animate-spin text-[var(--primary)]', sizeClasses[size], className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

export function LoadingState({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-[var(--foreground-muted)]">
      <Spinner size="lg" />
      <p className="mt-4 text-sm">{message}</p>
    </div>
  )
}

export function ErrorState({ 
  message = 'Something went wrong', 
  onRetry 
}: { 
  message?: string
  onRetry?: () => void 
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="text-4xl mb-4">⚠️</div>
      <p className="text-sm text-[oklch(0.65_0.18_25)] mb-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-sm text-[oklch(0.72_0.14_55)] hover:text-[oklch(0.65_0.16_55)] underline transition-colors duration-200"
        >
          Try again
        </button>
      )}
    </div>
  )
}

export function EmptyState({ 
  icon = '📭',
  title = 'Nothing here',
  description 
}: { 
  icon?: string
  title?: string
  description?: string 
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-[var(--foreground-muted)]">
      <div className="text-4xl mb-4">{icon}</div>
      <p className="font-medium text-[oklch(0.35_0_0)]">{title}</p>
      {description && <p className="text-sm mt-1">{description}</p>}
    </div>
  )
}
