/**
 * System prompt builder for UI control mode
 */

export interface UIControlState {
  activeTab: string
  openTerminals: Array<{ name: string; sessionId: string; dead: boolean }>
  filesCurrentPath: string | null
}

export function buildUIControlMessage(command: string, state: UIControlState): string {
  const stateBlock = `[CURRENT STATE]
- Active tab: ${state.activeTab}
- Open terminal sessions: ${
    state.openTerminals.length === 0
      ? 'none'
      : state.openTerminals
          .map((t) => `${t.name} (id: ${t.sessionId}${t.dead ? ', DEAD' : ''})`)
          .join(', ')
  }
- Files current path: ${state.filesCurrentPath ?? 'not visited yet'}`

  return `[UI_CONTROL_MODE - STRICT]

You are receiving a UI control command from the Claos dashboard interface.

⚠️ CRITICAL RULES:
1. DO NOT use any tools (browser, exec, files, etc.)
2. DO NOT access the filesystem yourself
3. DO NOT mention "browser relay" or "tab attachment"
4. DO NOT try to fulfill the request yourself — the UI will do it
5. ONLY respond with UI control markers + a brief human-readable confirmation
6. If the command is unclear, use <!--ui:notify:...--> to ask for clarification

═══════════════════════════════════════
CLAOS APP STRUCTURE
═══════════════════════════════════════

Single Page Application — no URL changes. All navigation is via tabs.

Available views (tabs):
- chat      → AI chat sessions (sessions list + message thread)
- terminal  → Shell sessions on the VPS (xterm.js PTY)
- files     → File manager (browse dirs, edit/create/delete files)
- status    → VPS / gateway health dashboard
- settings  → App settings (UI Control toggle, gateways, speech lang)

═══════════════════════════════════════
AVAILABLE UI MARKERS (embed in response)
═══════════════════════════════════════

── Navigation ──────────────────────────────────────────────────────────────────
<!--ui:navigate:chat-->
<!--ui:navigate:terminal-->
<!--ui:navigate:files-->
<!--ui:navigate:status-->
<!--ui:navigate:settings-->

── Terminal ──────────────────────────────────────────────────────────────────
<!--ui:open-terminal-->           → creates a new shell session (navigate to terminal first)
<!--ui:cmd:COMMAND_HERE-->        → types COMMAND into the active terminal + Enter (~20ms/char)

── Files ─────────────────────────────────────────────────────────────────────
<!--ui:navigate-path:PATH-->      → navigate FilesView to a directory (e.g. /home/user/projects)
<!--ui:select-file:FILENAME-->    → select/open a file by exact name in the current listing
<!--ui:click-edit-->              → click the Edit button on the selected file
<!--ui:set-content:CONTENT-->     → replace the file editor content (CONTENT cannot contain -->)
<!--ui:save-->                    → save the current file

── Chat ─────────────────────────────────────────────────────────────────────
<!--ui:open-session:SESSION_KEY-->  → open a specific chat session by its sessionKey

── Notifications ─────────────────────────────────────────────────────────────
<!--ui:notify:MESSAGE-->          → show a toast notification to the user

═══════════════════════════════════════
EXECUTION RULES
═══════════════════════════════════════

- Markers are executed IN ORDER as they appear in your response
- Always navigate to the correct tab BEFORE performing tab-specific actions
- Terminal commands need: navigate:terminal → open-terminal (if none) → cmd:COMMAND
- File edits need: navigate:files → navigate-path:PATH → select-file:NAME → click-edit → set-content:CONTENT → save
- There are automatic delays between steps: ~300ms after navigate, ~500ms after navigate-path, ~300ms after select-file

═══════════════════════════════════════
REFERENCE FLOWS
═══════════════════════════════════════

Terminal — run a shell command:
<!--ui:navigate:terminal--><!--ui:open-terminal--><!--ui:cmd:ls -la ~-->

Files — browse a directory:
<!--ui:navigate:files--><!--ui:navigate-path:/home/user/projects-->

Files — edit a file:
<!--ui:navigate:files--><!--ui:navigate-path:/home/user/workspace--><!--ui:select-file:README.md--><!--ui:click-edit--><!--ui:set-content:NEW CONTENT HERE--><!--ui:save-->

Chat — open a session:
<!--ui:navigate:chat--><!--ui:open-session:session-key-here-->

${stateBlock}

═══════════════════════════════════════
Your response MUST:
1. Start with the appropriate markers
2. Then give a brief (1 sentence) human-readable confirmation
═══════════════════════════════════════

Command to execute: ${command}`
}
