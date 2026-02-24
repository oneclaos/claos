'use client'

import { useState, useEffect, createContext, useContext, useCallback, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { X, CheckCircle, AlertCircle, Info, Undo2 } from 'lucide-react'
import { Button } from './button'

// Toast types
export interface Toast {
  id: string
  type: 'success' | 'error' | 'info' | 'undo'
  message: string
  duration?: number
  onUndo?: () => void
  undoLabel?: string
}

interface ToastContextType {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => string
  removeToast: (id: string) => void
  success: (message: string, duration?: number) => string
  error: (message: string, duration?: number) => string
  info: (message: string, duration?: number) => string
  undo: (message: string, onUndo: () => void, duration?: number) => string
}

const ToastContext = createContext<ToastContextType | null>(null)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const addToast = useCallback((toast: Omit<Toast, 'id'>): string => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const newToast: Toast = { ...toast, id }
    
    setToasts(prev => [...prev, newToast])

    // Auto-remove after duration
    const duration = toast.duration ?? (toast.type === 'undo' ? 8000 : 4000)
    if (duration > 0) {
      setTimeout(() => removeToast(id), duration)
    }

    return id
  }, [removeToast])

  const success = useCallback((message: string, duration?: number) => {
    return addToast({ type: 'success', message, duration })
  }, [addToast])

  const error = useCallback((message: string, duration?: number) => {
    return addToast({ type: 'error', message, duration })
  }, [addToast])

  const info = useCallback((message: string, duration?: number) => {
    return addToast({ type: 'info', message, duration })
  }, [addToast])

  const undo = useCallback((message: string, onUndo: () => void, duration?: number) => {
    return addToast({ type: 'undo', message, onUndo, duration })
  }, [addToast])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, info, undo }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  )
}

// Toast container - renders all active toasts
function ToastContainer({ toasts, onRemove }: { toasts: Toast[], onRemove: (id: string) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  )
}

// Individual toast item
function ToastItem({ toast, onRemove }: { toast: Toast, onRemove: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false)

  const handleRemove = useCallback(() => {
    setIsExiting(true)
    setTimeout(() => onRemove(toast.id), 200)
  }, [toast.id, onRemove])

  const handleUndo = useCallback(() => {
    if (toast.onUndo) {
      toast.onUndo()
    }
    handleRemove()
  }, [toast.onUndo, handleRemove])

  const Icon = {
    success: CheckCircle,
    error: AlertCircle,
    info: Info,
    undo: Undo2
  }[toast.type]

  const iconColor = {
    success: 'text-green-500',
    error: 'text-red-500',
    info: 'text-blue-500',
    undo: 'text-yellow-500'
  }[toast.type]

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg',
        'bg-[var(--background)] border border-[var(--border)]',
        'transition-all duration-200 transform',
        isExiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0',
        'animate-in slide-in-from-right-5'
      )}
    >
      <Icon className={cn('w-5 h-5 flex-shrink-0', iconColor)} />
      <span className="text-sm text-[var(--foreground)] flex-1">{toast.message}</span>
      
      {toast.type === 'undo' && toast.onUndo && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleUndo}
          className="text-xs font-medium"
        >
          <Undo2 className="w-3 h-3 mr-1" />
          {toast.undoLabel || 'Undo'}
        </Button>
      )}
      
      <button
        onClick={handleRemove}
        className="p-1 rounded hover:bg-[var(--muted)] text-[var(--foreground-muted)] transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
