/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ConversationList } from '@/components/chat/conversation-list'
import type { Session } from '@/lib/types'

const mockSessions: Session[] = [
  {
    sessionKey: 'session-1',
    gateway: 'james',
    gatewayName: 'James',
    channel: 'telegram',
    lastActive: new Date().toISOString(),
    messageCount: 5,
    customName: null,
  },
  {
    sessionKey: 'session-2',
    gateway: 'clawdio',
    gatewayName: 'Clawdio',
    channel: 'discord',
    lastActive: new Date(Date.now() - 3600000).toISOString(),
    messageCount: 12,
    customName: 'My Custom Chat',
  },
]

describe('ConversationList', () => {
  const mockOnSelect = jest.fn()
  const mockOnRename = jest.fn()
  const mockOnDelete = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should render empty state when no sessions', () => {
    render(
      <ConversationList 
        sessions={[]}
        selectedId={null}
        onSelect={mockOnSelect}
        onRename={mockOnRename}
        onDelete={mockOnDelete}
      />
    )
    expect(screen.getByText(/no conversations/i)).toBeInTheDocument()
  })

  it('should display sessions with avatar, name, and timestamp', () => {
    render(
      <ConversationList 
        sessions={mockSessions}
        selectedId={null}
        onSelect={mockOnSelect}
        onRename={mockOnRename}
        onDelete={mockOnDelete}
      />
    )
    
    expect(screen.getByText('James')).toBeInTheDocument()
    expect(screen.getByText('My Custom Chat')).toBeInTheDocument()
  })

  it('should filter sessions based on search query', () => {
    render(
      <ConversationList 
        sessions={mockSessions}
        selectedId={null}
        onSelect={mockOnSelect}
        onRename={mockOnRename}
        onDelete={mockOnDelete}
        searchQuery="custom"
      />
    )
    
    expect(screen.queryByText('James')).not.toBeInTheDocument()
    expect(screen.getByText('My Custom Chat')).toBeInTheDocument()
  })

  it('should call onSelect when clicking a conversation', () => {
    render(
      <ConversationList 
        sessions={mockSessions}
        selectedId={null}
        onSelect={mockOnSelect}
        onRename={mockOnRename}
        onDelete={mockOnDelete}
      />
    )
    
    fireEvent.click(screen.getByText('James'))
    expect(mockOnSelect).toHaveBeenCalledWith(mockSessions[0])
  })

  it('should highlight selected conversation', () => {
    render(
      <ConversationList 
        sessions={mockSessions}
        selectedId="session-1"
        onSelect={mockOnSelect}
        onRename={mockOnRename}
        onDelete={mockOnDelete}
      />
    )
    
    const selectedItem = screen.getByText('James').closest('[data-conversation]')
    expect(selectedItem).toHaveAttribute('data-selected', 'true')
  })

  it('should show context menu on right-click', async () => {
    render(
      <ConversationList 
        sessions={mockSessions}
        selectedId={null}
        onSelect={mockOnSelect}
        onRename={mockOnRename}
        onDelete={mockOnDelete}
      />
    )
    
    const item = screen.getByText('James').closest('[data-conversation]')
    fireEvent.contextMenu(item!)
    
    await waitFor(() => {
      expect(screen.getByText('Rename')).toBeInTheDocument()
      expect(screen.getByText('Delete')).toBeInTheDocument()
    })
  })
})
