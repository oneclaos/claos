import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({ 
  title, 
  description, 
  actions,
  className 
}: PageHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between mb-10', className)}>
      <div>
        <h1 className="text-3xl font-bold text-[oklch(0.15_0.02_60)] tracking-tight">{title}</h1>
        {description && (
          <p className="text-[oklch(0.50_0.01_60)] mt-2 text-base">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-4">
          {actions}
        </div>
      )}
    </div>
  )
}
