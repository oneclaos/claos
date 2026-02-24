# Claos UI Map

> Auto-generated inventory for the Agent UI Relay system.
> Last updated: 2025-01-01

---

## Architecture Overview

Claos is a **Single Page Application** (Next.js 15, React 19).
There are **no URL changes** when switching between views.
Navigation is controlled via **TabContext** (`navigateActiveTab(view)`).

### Available Views (TabView)

| view       | label     | description                              |
|------------|-----------|------------------------------------------|
| `chat`     | Chat      | AI chat sessions (sessions sidebar + messages) |
| `terminal` | Terminal  | Shell sessions on the VPS                |
| `files`    | Files     | File manager (browse, edit, create, delete) |
| `status`   | Status    | VPS status / gateway health              |
| `settings` | Settings  | App settings (UI Control, gateways, etc.) |
| `empty`    | New Tab   | Welcome screen                           |

---

## Per-View Interactive Elements

### 1. Chat View (`view = 'chat'`)

**Sessions Sidebar:**
- `[button] New Chat` — opens new chat modal
- `[button] New Group` — opens new group chat modal
- `[list] Sessions` — click to select/open a session
- `[button] Delete session` (hover per session) — deletes session

**Chat Input:**
- `[input] Message box` — type message, Enter to send
- `[button] Send` — sends the message
- `[button] Attach file` — opens file picker
- `[button] Alt+A` — activates voice dictation (when enabled)

**Chat Header:**
- `[button] Delete session` — deletes current session
- `[display] Session name` — shows current session label

**New Chat Modal:**
- `[select] Gateway` — pick which agent/gateway
- `[input] Session name` — optional name
- `[button] Create` / `[button] Cancel`

---

### 2. Terminal View (`view = 'terminal'`)

**Header:**
- `[button] New Shell` — creates a new PTY session

**Per terminal window:**
- `[button] Minimize/Maximize` (↕ icon) — toggle height
- `[button] Close` (✕ icon) — kill and close the session
- `[textarea] Terminal input` — the xterm.js terminal (receives keystrokes)

---

### 3. Files View (`view = 'files'`)

**Header actions:**
- `[button] Select` — toggles multi-select mode
- `[button] New File` — shows create file modal
- `[button] New Folder` — shows create folder modal
- `[button] Refresh` — re-fetches current directory

**Breadcrumb:**
- `[button] Home` — navigates to `/home/clawd/clawd`
- `[buttons] Path segments` — click any segment to navigate there

**File list (left panel, w-96):**
- `[button] ..` (parent dir) — navigates up one level
- `[entry] Directory` — click to navigate into it
- `[entry] File` — click to open preview/edit on the right panel
- `[button] Delete` (trash icon, on hover per entry) — deletes the item

**File editor (right panel):**
- `[display] Filename + metadata` (size, modified time)
- `[button] Edit` — enables editing mode
- `[button] Download` — downloads the file
- `[button] Close (✕)` — closes the preview
- `[textarea] Editor` — editable content when in edit mode
- `[button] Save` — saves the file (active when isEditing && hasUnsavedChanges)
- `[button] Cancel` — discards edits, returns to preview

**Create Modal:**
- `[input] Name` — filename or folder name
- `[button] Create` / `[button] Cancel`

**Multi-select bar (when items selected):**
- `[display] N selected`
- `[button] Clear` — deselects all
- `[button] Delete (N)` — bulk delete

**Keyboard shortcuts (Files View):**
- `Ctrl+S / Cmd+S` — save file (when editing)
- `Escape` — exit select mode

---

### 4. Status View (`view = 'status'`)

- `[display] Gateway list` — shows connected/offline gateways
- `[display] Health indicators` — CPU/memory/uptime stats per gateway

---

### 5. Settings View (`view = 'settings'`)

- `[toggle] UI Control enabled` — enables/disables the FloatingAgentButton
- `[select] Speech language` — language for voice dictation
- `[display] Gateway configuration` — add/edit/remove gateways

---

### 6. Tab Bar (always visible, desktop)

- `[button] +` — opens a new empty tab
- `[tab] Active tab` — highlighted tab
- `[tab] Click` — activates tab
- `[button] Close tab` (✕ on tab) — closes tab
- `[button] Notification bell` — shows unread count

---

## Dynamically Injected State

The following state is injected into every UI Control request in the `[CURRENT STATE]` section:

| field             | source              | description                              |
|-------------------|---------------------|------------------------------------------|
| `activeTab`       | `TabContext`        | Current view name (`chat`, `terminal`, `files`, `status`, `settings`) |
| `openTerminals`   | `TerminalContext`   | List of open shell sessions (id, sessionId, name, dead) |
| `filesCurrentPath`| `AgentUIControlContext` | Current directory path in Files view (null if not visited) |

---

## UI Relay Marker Vocabulary

### Existing Markers

| Marker | Description |
|--------|-------------|
| `<!--ui:navigate:TAB-->` | Navigate active tab to a view. TAB = `chat`, `terminal`, `files`, `status`, `settings` |
| `<!--ui:open-terminal-->` | Create a new shell session (navigates to terminal tab first) |
| `<!--ui:cmd:COMMAND-->` | Type a command into the active terminal (with Enter) |
| `<!--ui:notify:MESSAGE-->` | Show a toast notification to the user |

### New Markers (Phase 3)

| Marker | Description |
|--------|-------------|
| `<!--ui:navigate-path:PATH-->` | Navigate Files view to a directory path (e.g. `/home/clawd/prod`) |
| `<!--ui:select-file:FILENAME-->` | Select a file by name in the current Files directory listing |
| `<!--ui:click-edit-->` | Click the Edit button in the Files preview panel |
| `<!--ui:set-content:CONTENT-->` | Replace the file editor content (cannot contain `-->`) |
| `<!--ui:save-->` | Trigger file save in Files view |
| `<!--ui:open-session:SESSION_KEY-->` | Open a chat session by its sessionKey (navigates to chat tab) |

---

## Reference Flows

### Terminal Flow

```
<!--ui:navigate:terminal--><!--ui:open-terminal--><!--ui:cmd:YOUR_COMMAND_HERE-->
```

Steps:
1. Navigate to Terminal tab
2. Open a new shell (if none exist)
3. Type the command and press Enter (~20ms/char)

### Files Flow — Browse

```
<!--ui:navigate:files--><!--ui:navigate-path:/home/clawd/prod/claos-->
```

Steps:
1. Navigate to Files tab
2. Dispatch `FILES_NAVIGATE_PATH` event → FilesView fetches directory

### Files Flow — Edit File

```
<!--ui:navigate:files--><!--ui:navigate-path:/home/clawd/clawd--><!--ui:select-file:AGENTS.md--><!--ui:click-edit--><!--ui:set-content:NEW_CONTENT_HERE--><!--ui:save-->
```

Steps:
1. Navigate to Files tab
2. Navigate to the directory containing the file (300ms delay after nav)
3. Select the file by name (500ms delay after nav-path, waiting for dir load)
4. Click Edit button (300ms delay after select)
5. Set new content (100ms delay)
6. Trigger save (100ms delay)

### Chat Flow — Open Session

```
<!--ui:navigate:chat--><!--ui:open-session:SESSION_KEY-->
```

Steps:
1. Navigate to Chat tab
2. Find session by sessionKey in ChatContext.sessions
3. Call selectSession(session)

---

## Component Hierarchy

```
DashboardLayout
├── TabBar (always visible on desktop)
├── FloatingAgentButton (fixed bottom-right, hidden on chat view)
├── AgentActivePill (top pill when running)
└── ActiveTabView (switches based on activeTab.view)
    ├── ChatView → ChatHeader + MessageList + ChatInput
    │   └── (left panel) SessionsSidebar + ConversationList
    ├── TerminalView → list of TerminalWindow (xterm.js)
    ├── FilesView → Breadcrumb + FileList + FileEditor
    ├── StatusView → gateway health cards
    └── SettingsView → config toggles
```
