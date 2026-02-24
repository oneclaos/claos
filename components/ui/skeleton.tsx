import { cn } from "@/lib/utils"

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-[var(--muted)]",
        className
      )}
      {...props}
    />
  )
}

export function MessageSkeleton() {
  return (
    <div className="flex gap-3 animate-pulse">
      <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
      <div className="space-y-2 flex-1 max-w-[70%]">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  )
}

export function ChatSkeleton() {
  return (
    <div className="space-y-6 p-4">
      <MessageSkeleton />
      <div className="flex gap-3 justify-end animate-pulse">
        <div className="space-y-2 max-w-[70%]">
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
      </div>
      <MessageSkeleton />
      <div className="flex gap-3 justify-end animate-pulse">
        <div className="space-y-2 max-w-[70%]">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
      </div>
    </div>
  )
}

export function ConversationListSkeleton() {
  return (
    <div className="space-y-2 p-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 animate-pulse">
          <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function AgentCardSkeleton() {
  return (
    <div className="p-3 rounded-lg border border-[var(--border)] animate-pulse">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-full" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-12" />
        </div>
        <Skeleton className="w-5 h-5 rounded-full" />
      </div>
    </div>
  )
}
