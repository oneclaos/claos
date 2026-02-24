'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LoadingState, ErrorState, EmptyState, Spinner } from '@/components/ui/spinner'
import { cn, formatRelativeTime } from '@/lib/utils'
import { fetchWithCsrf } from '@/lib/csrf-client'
import type { AgentGroup, GroupMessage } from '@/lib/types'
import { Plus, Trash2, Send, Users, X, Check } from 'lucide-react'

interface Agent {
  id: string
  name: string
  gatewayId: string
  description: string
  avatar: string
  online: boolean
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<AgentGroup[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Selected group state
  const [selectedGroup, setSelectedGroup] = useState<AgentGroup | null>(null)
  const [groupMessages, setGroupMessages] = useState<GroupMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const currentGroupIdRef = useRef<string | null>(null) // Track current group to prevent race conditions
  
  // New group form
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [selectedAgents, setSelectedAgents] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  
  // Message input
  const [messageInput, setMessageInput] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Fetch groups and agents
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [groupsRes, agentsRes] = await Promise.all([
        fetch('/api/groups'),
        fetch('/api/agents')
      ])
      
      const groupsData = await groupsRes.json()
      const agentsData = await agentsRes.json()
      
      if (groupsData.error) throw new Error(groupsData.error)
      
      setGroups(groupsData.groups || [])
      setAgents(agentsData.agents || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [groupMessages])

  // Load group messages
  const selectGroup = async (group: AgentGroup) => {
    // Track this group as the current one
    currentGroupIdRef.current = group.id
    const requestedGroupId = group.id
    
    setSelectedGroup(group)
    setGroupMessages([])  // Clear messages immediately
    setMessagesLoading(true)
    
    try {
      const res = await fetch(`/api/groups/${group.id}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      
      // ✅ FIX: Only update if this group is still selected (prevent race conditions)
      if (currentGroupIdRef.current === requestedGroupId) {
        setGroupMessages(data.messages || [])
      }
    } catch (err) {
      console.error('Failed to load group messages:', err)
      // Only clear if this group is still selected
      if (currentGroupIdRef.current === requestedGroupId) {
        setGroupMessages([])
      }
    } finally {
      // Only update loading state if this group is still selected
      if (currentGroupIdRef.current === requestedGroupId) {
        setMessagesLoading(false)
      }
    }
  }

  // Create new group
  const createGroup = async () => {
    if (!newGroupName.trim() || selectedAgents.length === 0) return
    
    setCreating(true)
    try {
      const res = await fetchWithCsrf('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newGroupName.trim(),
          agents: selectedAgents.map(id => {
            const agent = agents.find(a => a.id === id)
            return { id, gatewayId: agent?.gatewayId || id }
          })
        })
      })
      
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      
      setGroups([data.group, ...groups])
      setShowCreateForm(false)
      setNewGroupName('')
      setSelectedAgents([])
      selectGroup(data.group)
    } catch (err) {
      console.error('Failed to create group:', err)
    } finally {
      setCreating(false)
    }
  }

  // Delete group
  const deleteGroupHandler = async (groupId: string) => {
    if (!confirm('Are you sure you want to delete this group?')) return
    
    try {
      await fetchWithCsrf(`/api/groups?id=${groupId}`, { method: 'DELETE' })
      setGroups(groups.filter(g => g.id !== groupId))
      if (selectedGroup?.id === groupId) {
        currentGroupIdRef.current = null // Clear ref when deselecting
        setSelectedGroup(null)
        setGroupMessages([])
      }
    } catch (err) {
      console.error('Failed to delete group:', err)
    }
  }

  // Send message to group with SSE streaming
  const sendMessage = async () => {
    if (!messageInput.trim() || !selectedGroup || sending) return
    
    const content = messageInput.trim()
    const targetGroupId = selectedGroup.id // Capture group ID for this message
    setMessageInput('')
    setSending(true)
    
    // Optimistically add message with pending responses
    const optimisticId = 'temp-' + Date.now()
    const optimisticMessage: GroupMessage = {
      id: optimisticId,
      groupId: targetGroupId,
      content,
      timestamp: new Date().toISOString(),
      responses: selectedGroup.agents.map(a => ({
        agentId: a.id,
        agentName: a.name,
        content: '',
        timestamp: '',
        status: 'pending' as const
      }))
    }
    
    // Only add message if group is still selected
    if (currentGroupIdRef.current === targetGroupId) {
      setGroupMessages(prev => [...prev, optimisticMessage])
    }
    
    try {
      // Get CSRF token from cookie
      const csrfToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('csrf_token='))
        ?.split('=')[1]
      
      if (!csrfToken) {
        throw new Error('CSRF token not found')
      }

      // Fetch with SSE-compatible options
      const response = await fetch(`/api/groups/${selectedGroup.id}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({ message: content })
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      // Read SSE stream
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalMessage: GroupMessage | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              
              if (data.type === 'start') {
                // Message started
                console.log('Stream started:', data)
              } else if (data.type === 'response') {
                // Update specific agent response (only if group still selected)
                if (currentGroupIdRef.current === targetGroupId) {
                  setGroupMessages(prev => 
                    prev.map(m => {
                      if (m.id === optimisticId) {
                        return {
                          ...m,
                          responses: m.responses.map(r =>
                            r.agentId === data.agentId
                              ? {
                                  agentId: data.agentId,
                                  agentName: data.agentName,
                                  content: data.content,
                                  timestamp: data.timestamp,
                                  status: data.status,
                                  error: data.error
                                }
                              : r
                          )
                        }
                      }
                      return m
                    })
                  )
                }
              } else if (data.type === 'done') {
                // All responses received
                finalMessage = data.message
              } else if (data.type === 'error') {
                throw new Error(data.error)
              }
            } catch (parseErr) {
              console.error('Failed to parse SSE data:', parseErr)
            }
          }
        }
      }

      // Replace optimistic message with final one (only if group still selected)
      if (finalMessage && currentGroupIdRef.current === targetGroupId) {
        setGroupMessages(prev => 
          prev.map(m => m.id === optimisticId ? finalMessage! : m)
        )
      }
    } catch (err) {
      console.error('Failed to send message:', err)
      // Remove optimistic message on error (only if group still selected)
      if (currentGroupIdRef.current === targetGroupId) {
        setGroupMessages(prev => prev.filter(m => m.id !== optimisticId))
      }
    } finally {
      // Only update sending state if group still selected
      if (currentGroupIdRef.current === targetGroupId) {
        setSending(false)
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const toggleAgent = (agentId: string) => {
    setSelectedAgents(prev =>
      prev.includes(agentId)
        ? prev.filter(id => id !== agentId)
        : [...prev, agentId]
    )
  }

  return (
    <>
      <div className="p-8 h-full flex flex-col">
        <PageHeader
          title="Agent Groups"
          description="Create groups to message multiple agents at once"
          actions={
            <Button onClick={() => setShowCreateForm(true)}>
              <Plus className="h-4 w-4" />
              New Group
            </Button>
          }
        />

        <div className="flex-1 flex gap-6 min-h-0">
          {/* Groups list */}
          <Card className="w-80 flex flex-col">
            <CardHeader className="pb-2 border-b border-[var(--border)]">
              <CardTitle className="text-sm font-medium text-[var(--foreground-muted)]">Groups</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-0">
              {loading && <LoadingState message="Loading groups..." />}
              {error && <ErrorState message={error} onRetry={fetchData} />}
              {!loading && !error && groups.length === 0 && (
                <EmptyState
                  icon="👥"
                  title="No groups"
                  description="Create a group to start"
                />
              )}
              {!loading && groups.map((group) => (
                <div
                  key={group.id}
                  className={cn(
                    'p-4 border-b border-[var(--border)] cursor-pointer hover:bg-[var(--background)] transition-colors duration-200',
                    selectedGroup?.id === group.id && 'bg-[oklch(0.92_0.06_55)]'
                  )}
                  onClick={() => selectGroup(group)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[var(--foreground)] truncate">{group.name}</div>
                      <div className="text-sm text-[var(--foreground-muted)] flex items-center gap-1 mt-1">
                        <Users className="h-3 w-3" />
                        {group.agents.length} agents
                      </div>
                      <div className="flex gap-1 mt-2">
                        {group.agents.slice(0, 3).map(a => (
                          <span key={a.id} className="text-lg" title={a.name}>
                            {a.avatar}
                          </span>
                        ))}
                        {group.agents.length > 3 && (
                          <span className="text-xs text-[var(--foreground-muted)]">
                            +{group.agents.length - 3}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-[var(--foreground-muted)] hover:text-[var(--error)] hover:bg-[oklch(0.95_0.05_25)]"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteGroupHandler(group.id)
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Chat area */}
          <Card className="flex-1 flex flex-col">
            {!selectedGroup ? (
              <div className="flex-1 flex items-center justify-center text-[var(--foreground-muted)]">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-2xl bg-[var(--background-secondary)] flex items-center justify-center mx-auto mb-4">
                    <Users className="h-8 w-8 text-[var(--foreground-muted)]" />
                  </div>
                  <p className="font-medium text-[var(--foreground-secondary)]">Select a group or create a new one</p>
                </div>
              </div>
            ) : (
              <>
                <div className="p-5 border-b border-[var(--border)]">
                  <h3 className="font-medium text-[var(--foreground)]">{selectedGroup.name}</h3>
                  <p className="text-sm text-[var(--foreground-muted)]">
                    {selectedGroup.agents.map(a => a.name).join(', ')}
                  </p>
                </div>
                <CardContent className="flex-1 overflow-y-auto p-5">
                  {messagesLoading && <LoadingState message="Loading messages..." />}
                  {!messagesLoading && groupMessages.length === 0 && (
                    <EmptyState
                      icon="💬"
                      title="No messages"
                      description="Send a message to all agents"
                    />
                  )}
                  {!messagesLoading && groupMessages.length > 0 && (
                    <div className="space-y-6">
                      {groupMessages.map((msg) => (
                        <div key={msg.id} className="space-y-3">
                          {/* User message */}
                          <div className="flex justify-end">
                            <div className="bg-[var(--primary)] text-white rounded-2xl px-4 py-3 max-w-[70%] shadow-sm">
                              <div className="whitespace-pre-wrap break-words">
                                {msg.content}
                              </div>
                              <div className="text-xs text-white/60 mt-1">
                                {formatRelativeTime(msg.timestamp)}
                              </div>
                            </div>
                          </div>
                          {/* Agent responses */}
                          <div className="space-y-2 pl-4 border-l-2 border-[var(--border)]">
                            {msg.responses.map((resp) => {
                              const agent = selectedGroup.agents.find(
                                a => a.id === resp.agentId
                              )
                              return (
                                <div
                                  key={resp.agentId}
                                  className="bg-[var(--background)] rounded-2xl px-4 py-3 border border-[var(--border)]"
                                >
                                  <div className="text-xs text-[var(--foreground-muted)] mb-1 flex items-center gap-1">
                                    <span>{agent?.avatar || '💬'}</span>
                                    <span>{resp.agentName}</span>
                                    {resp.status === 'pending' && (
                                      <Spinner size="sm" className="ml-1" />
                                    )}
                                    {resp.status === 'error' && (
                                      <span className="text-[var(--error)] ml-1">error</span>
                                    )}
                                  </div>
                                  {resp.status === 'complete' && (
                                    <div className="whitespace-pre-wrap break-words text-[var(--foreground)]">
                                      {resp.content}
                                    </div>
                                  )}
                                  {resp.status === 'pending' && (
                                    <div className="text-[var(--foreground-muted)] italic">
                                      Thinking...
                                    </div>
                                  )}
                                  {resp.status === 'error' && (
                                    <div className="text-[var(--error)] text-sm">
                                      {resp.error || 'Failed to get response'}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </CardContent>
                <div className="border-t border-[var(--border)] p-5">
                  <div className="flex gap-3">
                    <Input
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={`Message all agents in ${selectedGroup.name}...`}
                      disabled={sending}
                    />
                    <Button onClick={sendMessage} disabled={!messageInput.trim() || sending}>
                      {sending ? <Spinner size="sm" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>

        {/* Create Group Modal */}
        {showCreateForm && (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50">
            <Card className="w-full max-w-md shadow-2xl">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-[var(--foreground)]">Create Agent Group</CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowCreateForm(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm text-[var(--foreground-muted)] mb-2 block font-medium">
                    Group Name
                  </label>
                  <Input
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="My Agent Team"
                  />
                </div>
                <div>
                  <label className="text-sm text-[var(--foreground-muted)] mb-3 block font-medium">
                    Select Agents ({selectedAgents.length} selected)
                  </label>
                  <div className="space-y-2">
                    {agents.map((agent) => (
                      <button
                        key={agent.id}
                        onClick={() => toggleAgent(agent.id)}
                        disabled={!agent.online}
                        className={cn(
                          'w-full p-4 rounded-xl text-left flex items-center gap-3 transition-all duration-200',
                          selectedAgents.includes(agent.id)
                            ? 'bg-[oklch(0.92_0.06_55)] border-2 border-[var(--primary)]'
                            : 'bg-[var(--background-secondary)] border-2 border-transparent hover:bg-[var(--border)]',
                          !agent.online && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        <span className="text-xl">{agent.avatar}</span>
                        <div className="flex-1">
                          <div className="font-medium flex items-center gap-2 text-[var(--foreground)]">
                            {agent.name}
                            <span
                              className={cn(
                                'w-2 h-2 rounded-full',
                                agent.online ? 'bg-[var(--success)]' : 'bg-[var(--error)]'
                              )}
                            />
                          </div>
                          <div className="text-sm text-[var(--foreground-muted)]">
                            {agent.description}
                          </div>
                        </div>
                        {selectedAgents.includes(agent.id) && (
                          <div className="w-6 h-6 rounded-full bg-[var(--primary)] flex items-center justify-center">
                            <Check className="h-4 w-4 text-white" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setShowCreateForm(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={createGroup}
                    disabled={!newGroupName.trim() || selectedAgents.length === 0 || creating}
                  >
                    {creating ? <Spinner size="sm" /> : 'Create Group'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </>
  )
}
