/**
 * @jest-environment jsdom
 */

import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { TabProvider } from '@/context/tab-context'

// Mock Next.js navigation (still used for Settings link + logo)
jest.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

jest.mock('next/link', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function MockLink({ children, href, ...props }: any) {
    return <a href={href} {...props}>{children}</a>
  }
})

// Import after mocks
import { Sidebar } from '@/components/layout/sidebar'

function renderWithProvider() {
  return render(
    <TabProvider>
      <Sidebar />
    </TabProvider>
  )
}

/** Helper: get the desktop sidebar element */
function getDesktopSidebar() {
  return screen.getByTestId('desktop-sidebar')
}

describe('Sidebar', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('should render with collapsed width by default', () => {
    renderWithProvider()
    const sidebar = getDesktopSidebar()
    expect(sidebar).toHaveClass('w-[56px]')
  })

  it('should expand on mouse enter', () => {
    renderWithProvider()
    const sidebar = getDesktopSidebar()
    fireEvent.mouseEnter(sidebar)
    expect(sidebar).toHaveClass('w-[220px]')
  })

  it('should collapse on mouse leave', () => {
    renderWithProvider()
    const sidebar = getDesktopSidebar()
    fireEvent.mouseEnter(sidebar)
    fireEvent.mouseLeave(sidebar)
    expect(sidebar).toHaveClass('w-[56px]')
  })

  it('should show only icons when collapsed', () => {
    renderWithProvider()
    const desktopSidebar = getDesktopSidebar()
    // Query labels only within the desktop sidebar (mobile overlay has them expanded)
    const labels = within(desktopSidebar).queryAllByText(/^Chat$|^Shell$|^Status$|^Files$|^Settings$/)
    labels.forEach(label => {
      expect(label).toHaveClass('opacity-0')
    })
  })

  it('should have nav buttons for Chat, Shell, Status, Files', () => {
    renderWithProvider()
    const desktopSidebar = getDesktopSidebar()
    const chatBtn = within(desktopSidebar).getByRole('button', { name: /chat/i })
    const shellBtn = within(desktopSidebar).getByRole('button', { name: /shell/i })
    const statusBtn = within(desktopSidebar).getByRole('button', { name: /status/i })
    const filesBtn = within(desktopSidebar).getByRole('button', { name: /files/i })
    expect(chatBtn).toBeInTheDocument()
    expect(shellBtn).toBeInTheDocument()
    expect(statusBtn).toBeInTheDocument()
    expect(filesBtn).toBeInTheDocument()
  })

  // TODO: Settings link not yet implemented
  it.skip('should have a Settings link', () => {
    renderWithProvider()
    const desktopSidebar = getDesktopSidebar()
    const links = within(desktopSidebar).getAllByRole('link')
    const settingsLink = links.find(l => l.getAttribute('href') === '/settings')
    expect(settingsLink).toBeTruthy()
  })

  it('should support keyboard navigation on nav buttons', () => {
    renderWithProvider()
    const desktopSidebar = getDesktopSidebar()
    const buttons = within(desktopSidebar).getAllByRole('button')
    // First nav button (Chat) should be focusable
    const chatBtn = buttons.find(b => b.getAttribute('aria-label') === 'Chat' || b.title === 'Chat')
    expect(chatBtn).toBeTruthy()
    chatBtn!.focus()
    expect(document.activeElement).toBe(chatBtn)
  })

  it('should show Chat nav item with aria-current when default tab view is chat', async () => {
    renderWithProvider()
    // Wait for TabProvider init (useEffect with setTimeout)
    await new Promise(r => setTimeout(r, 100))
    const desktopSidebar = getDesktopSidebar()
    const currentItems = within(desktopSidebar).queryAllByRole('button', { current: 'page' })
    // Default tab is 'chat', so Chat button should be active
    expect(currentItems).toHaveLength(1)
    expect(currentItems[0]).toHaveAttribute('aria-label', 'Chat')
  })

  it('should be inline (no fixed positioning) when expanded', () => {
    renderWithProvider()
    const sidebar = getDesktopSidebar()
    fireEvent.mouseEnter(sidebar)
    // Sidebar is inline — must NOT use fixed positioning
    expect(sidebar).not.toHaveClass('fixed')
    expect(sidebar).toHaveClass('h-full')
  })

  it('should collapse on mouse leave (no overlay needed)', () => {
    renderWithProvider()
    const sidebar = getDesktopSidebar()
    fireEvent.mouseEnter(sidebar)
    expect(sidebar).toHaveClass('w-[220px]')

    fireEvent.mouseLeave(sidebar)
    expect(sidebar).toHaveClass('w-[56px]')
  })

  it('should render a mobile hamburger button', () => {
    renderWithProvider()
    const hamburger = screen.getByRole('button', { name: /open navigation menu/i })
    expect(hamburger).toBeInTheDocument()
  })

  it('should open mobile sidebar when hamburger is clicked', () => {
    renderWithProvider()
    const hamburger = screen.getByRole('button', { name: /open navigation menu/i })
    fireEvent.click(hamburger)
    expect(hamburger).toHaveAttribute('aria-expanded', 'true')
    const mobileSidebar = screen.getByTestId('mobile-sidebar')
    expect(mobileSidebar).toHaveClass('translate-x-0')
  })
})
