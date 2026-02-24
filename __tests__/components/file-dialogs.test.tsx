/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CreateFileDialog, DeleteFileDialog } from '@/components/ui/file-dialogs'

// Mock Radix UI portal behavior
jest.mock('@radix-ui/react-dialog', () => {
  const actual = jest.requireActual('@radix-ui/react-dialog')
  return {
    ...actual,
    Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
})

describe('CreateFileDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: jest.fn(),
    currentPath: '/home/user',
    onConfirm: jest.fn().mockResolvedValue(undefined)
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders dialog title when open', () => {
    render(<CreateFileDialog {...defaultProps} />)
    
    expect(screen.getByRole('heading', { name: 'Create New' })).toBeInTheDocument()
  })

  it('shows name input', () => {
    render(<CreateFileDialog {...defaultProps} />)
    
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('shows create file button', () => {
    render(<CreateFileDialog {...defaultProps} />)
    
    // Button text includes "Create File" or "Create Folder"
    expect(screen.getByRole('button', { name: /^create file$/i })).toBeInTheDocument()
  })

  it('calls onConfirm with valid name', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    render(<CreateFileDialog {...defaultProps} onConfirm={onConfirm} />)
    
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'test.txt' } })
    
    const createBtn = screen.getByRole('button', { name: /^create file$/i })
    fireEvent.click(createBtn)
    
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith('test.txt', 'file')
    })
  })

  it('has cancel button', () => {
    render(<CreateFileDialog {...defaultProps} />)
    
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })
})

describe('DeleteFileDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: jest.fn(),
    itemName: 'test.txt',
    itemType: 'file' as const,
    onConfirm: jest.fn().mockResolvedValue(undefined)
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders dialog with delete title', () => {
    render(<DeleteFileDialog {...defaultProps} />)
    
    expect(screen.getByRole('heading', { name: /delete file/i })).toBeInTheDocument()
  })

  it('shows item name', () => {
    render(<DeleteFileDialog {...defaultProps} />)
    
    expect(screen.getByText('test.txt')).toBeInTheDocument()
  })

  it('has delete and cancel buttons', () => {
    render(<DeleteFileDialog {...defaultProps} />)
    
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('calls onConfirm when delete clicked', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    render(<DeleteFileDialog {...defaultProps} onConfirm={onConfirm} />)
    
    const deleteBtn = screen.getByRole('button', { name: /^delete$/i })
    fireEvent.click(deleteBtn)
    
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalled()
    })
  })

  it('calls onOpenChange when cancel clicked', () => {
    const onOpenChange = jest.fn()
    render(<DeleteFileDialog {...defaultProps} onOpenChange={onOpenChange} />)
    
    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelBtn)
    
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
