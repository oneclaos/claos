'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useTabContext } from '@/context/tab-context'
import type { TabView } from '@/lib/tab-types'
import {
  MessageSquare,
  FolderOpen,
  LogOut,
  Settings,
  Activity,
  TerminalSquare,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react'

// ─── Data ──────────────────────────────────────────────────────────────────────

interface NavButtonItem {
  view: TabView
  label: string
  icon: LucideIcon
}

interface NavLinkItem {
  href: string
  label: string
  icon: LucideIcon
}

const chatNavItems: NavButtonItem[] = [
  { view: 'chat', label: 'Chat', icon: MessageSquare },
  { view: 'terminal', label: 'Shell', icon: TerminalSquare },
]

const systemNavItems: NavButtonItem[] = [
  { view: 'status', label: 'Status', icon: Activity },
  { view: 'files', label: 'Files', icon: FolderOpen },
  { view: 'settings', label: 'Settings', icon: Settings },
]

// ─── Shared class builder ────────────────────────────────────────────────────

function navItemClass(isActive: boolean, isExpanded: boolean) {
  return cn(
    'flex items-center h-10 w-full relative rounded-lg overflow-hidden',
    'transition-all duration-200',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1',
    isExpanded ? 'mx-2 pr-3' : 'mx-1',
    isActive
      ? 'text-[var(--color-primary)] bg-[oklch(0.70_0.20_46_/_0.10)]'
      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
  )
}

const labelClass = (isExpanded: boolean) =>
  cn(
    'text-sm font-medium whitespace-nowrap overflow-hidden',
    'transition-all duration-200',
    isExpanded ? 'opacity-100 max-w-[140px]' : 'opacity-0 max-w-0'
  )

// ─── NavButton — for Chat / Shell / Status / Files ───────────────────────────

function NavButton({
  item,
  isActive,
  isExpanded,
  index,
  onClick,
}: {
  item: NavButtonItem
  isActive: boolean
  isExpanded: boolean
  index: number
  onClick: () => void
}) {
  return (
    <li>
      <button
        onClick={onClick}
        data-nav-index={index}
        title={!isExpanded ? item.label : undefined}
        aria-label={isExpanded ? undefined : item.label}
        aria-current={isActive ? 'page' : undefined}
        className={navItemClass(isActive, isExpanded)}
      >
        <span className="w-[56px] flex-shrink-0 flex items-center justify-center">
          <item.icon className="h-[18px] w-[18px] flex-shrink-0" />
        </span>
        <span className={labelClass(isExpanded)}>{item.label}</span>
      </button>
    </li>
  )
}

// ─── NavLink — for Settings (external routing) ───────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _NavLink({
  item,
  isActive,
  isExpanded,
  index,
}: {
  item: NavLinkItem
  isActive: boolean
  isExpanded: boolean
  index: number
}) {
  return (
    <li>
      <Link
        href={item.href}
        data-nav-index={index}
        title={!isExpanded ? item.label : undefined}
        aria-label={isExpanded ? undefined : item.label}
        aria-current={isActive ? 'page' : undefined}
        className={navItemClass(isActive, isExpanded)}
      >
        <span className="w-[56px] flex-shrink-0 flex items-center justify-center">
          <item.icon className="h-[18px] w-[18px] flex-shrink-0" />
        </span>
        <span className={labelClass(isExpanded)}>{item.label}</span>
      </Link>
    </li>
  )
}

// ─── SidebarInner — shared content for desktop & mobile ──────────────────────

function SidebarInner({
  isExpanded,
  activeView,
  pathname: _pathname,
  onNav,
  isMobile = false,
  onClose,
}: {
  isExpanded: boolean
  activeView: TabView | null
  pathname: string
  onNav: (view: TabView) => void
  isMobile?: boolean
  onClose?: () => void
}) {
  const handleLogout = async () => {
    await fetch('/api/auth', { method: 'DELETE' })
    window.location.href = '/login'
  }

  return (
    <>
      {/* ── Header ── */}
      <div className="flex items-center h-14 border-b border-[var(--color-border)] flex-shrink-0 overflow-hidden">
        {isMobile ? (
          // Mobile header: logo + title + close button
          <div className="flex items-center w-full px-4">
            <Image
              src="/logo.svg"
              alt="Logo"
              width={52}
              height={52}
              className="flex-shrink-0 object-contain"
            />
            <div className="flex flex-col ml-3 flex-1 min-w-0">
              <span
                className="text-sm whitespace-nowrap"
                style={{ fontFamily: 'var(--font-serif)', fontWeight: 400 }}
              >
                Claos
              </span>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] flex-shrink-0" />
                <span className="text-[11px] text-[var(--color-text-muted)]">Online</span>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close navigation"
              className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] transition-colors flex-shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          // Desktop header: animated link
          <Link
            href="/"
            className="flex items-center group min-w-0 w-full"
            aria-label={isExpanded ? undefined : 'Claos Home'}
          >
            <span className="w-[56px] flex-shrink-0 flex items-center justify-center">
              <Image
                src="/logo.svg"
                alt="Logo"
                width={52}
                height={52}
                className="object-contain transition-transform duration-200 group-hover:scale-105"
              />
            </span>
            <div
              className={cn(
                'flex flex-col min-w-0 overflow-hidden pr-3',
                'transition-all duration-200',
                isExpanded ? 'opacity-100 max-w-[160px]' : 'opacity-0 max-w-0'
              )}
            >
              <span
                className="text-sm whitespace-nowrap"
                style={{ fontFamily: 'var(--font-serif)', fontWeight: 400 }}
              >
                Claos
              </span>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] flex-shrink-0" />
                <span className="text-[11px] text-[var(--color-text-muted)] whitespace-nowrap">
                  Online
                </span>
              </div>
            </div>
          </Link>
        )}
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 py-3 overflow-hidden" role="navigation" aria-label="Main navigation">
        {/* Chat section */}
        <div className="mb-1">
          <div className="h-6 flex items-center">
            <p
              className={cn(
                'text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] px-5 transition-opacity duration-100',
                isExpanded ? 'opacity-100' : 'opacity-0'
              )}
            >
              Chat
            </p>
          </div>
          <ul className="space-y-0.5">
            {chatNavItems.map((item, index) => (
              <NavButton
                key={item.view}
                item={item}
                isActive={activeView === item.view}
                isExpanded={isExpanded}
                index={index}
                onClick={() => onNav(item.view)}
              />
            ))}
          </ul>
        </div>

        {/* Divider */}
        <div
          className={cn(
            'my-2',
            isExpanded
              ? 'mx-4 border-t border-[var(--color-border)]'
              : 'mx-3 border-t border-[var(--color-border)]'
          )}
        />

        {/* System section */}
        <div>
          <div className="h-6 flex items-center">
            <p
              className={cn(
                'text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] px-5 transition-opacity duration-100',
                isExpanded ? 'opacity-100' : 'opacity-0'
              )}
            >
              System
            </p>
          </div>
          <ul className="space-y-0.5">
            {systemNavItems.map((item, index) => (
              <NavButton
                key={item.view}
                item={item}
                isActive={activeView === item.view}
                isExpanded={isExpanded}
                index={chatNavItems.length + index}
                onClick={() => onNav(item.view)}
              />
            ))}
          </ul>
        </div>
      </nav>

      {/* ── Bottom: Logout ── */}
      <div className="flex-shrink-0 border-t border-[var(--color-border)] py-2">
        <div className={cn(isExpanded ? 'mx-2' : 'mx-1')}>
          <button
            onClick={handleLogout}
            title={!isExpanded ? 'Logout' : undefined}
            aria-label={isExpanded ? undefined : 'Logout'}
            className={cn(
              'flex items-center h-10 w-full rounded-lg',
              'transition-all duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1',
              'text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-500',
              isExpanded ? 'px-3 gap-3' : 'justify-center'
            )}
          >
            <LogOut className="h-[18px] w-[18px] flex-shrink-0" />
            <span
              className={cn(
                'text-sm font-medium whitespace-nowrap overflow-hidden',
                'transition-all duration-200',
                isExpanded ? 'opacity-100 max-w-[160px]' : 'opacity-0 max-w-0'
              )}
            >
              Logout
            </span>
          </button>
        </div>
      </div>
    </>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname()
  const [isExpanded, setIsExpanded] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const { navigateActiveTab, openTab, activeTab, tabs } = useTabContext()
  const activeTabId = tabs.find((t) => t.isActive)?.id ?? null

  const handleMouseEnter = useCallback(() => setIsExpanded(true), [])
  const handleMouseLeave = useCallback(() => setIsExpanded(false), [])

  const handleNav = useCallback(
    (view: TabView) => {
      if (activeTabId) {
        navigateActiveTab(view)
      } else {
        openTab(view)
      }
      setIsExpanded(false)
      setIsMobileOpen(false)
    },
    [navigateActiveTab, openTab, activeTabId]
  )

  const activeView = activeTab?.view ?? null

  return (
    <>
      {/* ── Mobile: hamburger button (fixed, visible only on mobile) ── */}
      <button
        className={cn(
          'md:hidden fixed top-3.5 left-4 z-40',
          'p-1.5 rounded-md text-[var(--color-text-muted)]',
          'hover:bg-[var(--color-bg-hover)] transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]'
        )}
        onClick={() => setIsMobileOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={isMobileOpen}
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* ── Mobile: overlay sidebar ── */}
      <div
        className={cn(
          'md:hidden fixed inset-0 z-50',
          'transition-opacity duration-200',
          isMobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        aria-hidden={!isMobileOpen}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/40"
          onClick={() => setIsMobileOpen(false)}
          aria-label="Close navigation"
        />

        {/* Sidebar panel */}
        <aside
          data-testid="mobile-sidebar"
          className={cn(
            'absolute top-0 left-0 h-full w-[220px] bg-white flex flex-col',
            'border-r border-[var(--color-border)] shadow-xl',
            'transition-transform duration-200',
            isMobileOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <SidebarInner
            isExpanded={true}
            activeView={activeView}
            pathname={pathname}
            onNav={handleNav}
            isMobile={true}
            onClose={() => setIsMobileOpen(false)}
          />
        </aside>
      </div>

      {/* ── Desktop: regular sidebar with hover ── */}
      <aside
        data-testid="desktop-sidebar"
        className={cn(
          'hidden md:flex h-full bg-white flex-col border-r border-[var(--color-border)] z-10 flex-shrink-0',
          'transition-all duration-100 ease-in-out',
          'motion-reduce:transition-none',
          isExpanded ? 'w-[220px] shadow-lg' : 'w-[56px]'
        )}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <SidebarInner
          isExpanded={isExpanded}
          activeView={activeView}
          pathname={pathname}
          onNav={handleNav}
          isMobile={false}
        />
      </aside>
    </>
  )
}
