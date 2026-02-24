'use client'
import { Component, ReactNode } from 'react'

interface Props { children: ReactNode; fallback?: ReactNode }
interface State { hasError: boolean; error?: Error }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex items-center justify-center h-full p-8">
          <div className="text-center">
            <p className="text-sm font-medium text-[var(--color-text-primary)] mb-1">Something went wrong</p>
            <p className="text-xs text-[var(--color-text-muted)] mb-3">{this.state.error?.message}</p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="text-xs px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
