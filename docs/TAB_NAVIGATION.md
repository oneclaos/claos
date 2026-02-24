# Tab Navigation — Plan d'implémentation

**Feature:** Remplacer la sidebar par une navigation en onglets (browser-like)  
**Status:** Planifiée  
**Priorité:** Medium

---

## 1. Vue d'ensemble

Remplacer la sidebar de sessions par une barre d'onglets horizontale en haut du dashboard. Chaque session ouverte = un onglet. Navigation clavier via raccourcis `Alt+*`.

**Before:** Sidebar gauche avec liste de sessions  
**After:** Barre d'onglets horizontale (style browser/VS Code)

---

## 2. Raccourcis clavier

| Raccourci | Action |
|-----------|--------|
| `Alt+T` | Ouvrir nouvelle session (picker) |
| `Alt+W` | Fermer l'onglet actif |
| `Alt+←` | Onglet précédent |
| `Alt+→` | Onglet suivant |
| `Alt+Shift+T` | Réouvrir le dernier onglet fermé |
| `Alt+1` à `Alt+9` | Aller directement à l'onglet N |

**Pourquoi Alt et pas Ctrl :** `Ctrl+T`, `Ctrl+W` sont interceptés par le navigateur avant JavaScript. `Alt+*` n'a pas ce problème.

---

## 3. Modèle de données

### TabState
```typescript
interface Tab {
  id: string              // uuid
  sessionKey: string      // lié à une Session Clawdbot
  gatewayId: string
  label: string           // nom affiché dans l'onglet
  isPinned: boolean       // onglet épinglé (non fermable)
  isActive: boolean
  hasUnread: boolean      // indicateur de message non lu
  openedAt: number        // timestamp
}

interface TabManagerState {
  tabs: Tab[]
  activeTabId: string | null
  closedTabsHistory: Tab[]  // pour Alt+Shift+T, max 10 entrées
}
```

### Persistence
- `localStorage` clé `claos_tabs` — shape validé avec Zod au load
- Format versionné : `{ version: 1, tabs: Tab[], activeTabId: string }`
- Purge auto si version mismatch

---

## 4. Architecture des composants

```
app/(dashboard)/
├── layout.tsx              ← Wrapper avec TabProvider
├── page.tsx                ← Consumer des tabs (simplifié)
└── components/
    └── tabs/
        ├── TabBar.tsx          ← Barre d'onglets horizontale
        ├── TabItem.tsx         ← Un onglet (label, close btn, unread dot)
        ├── TabNewButton.tsx    ← Bouton "+" pour nouvelle session
        └── TabOverflowMenu.tsx ← Menu dropdown si trop d'onglets

context/
└── tab-context.tsx         ← TabProvider + useTab hook
    ├── state: TabManagerState
    ├── openTab(session)
    ├── closeTab(tabId)
    ├── activateTab(tabId)
    ├── navigateTab(direction: 'prev' | 'next')
    └── reopenLastClosed()

hooks/
└── useTabKeyboard.ts       ← Gestionnaire des raccourcis Alt+*
```

---

## 5. Implémentation détaillée

### 5.1 TabContext (`context/tab-context.tsx`)

```typescript
// Actions exposées
openTab(session: Session): void
closeTab(tabId: string): void
activateTab(tabId: string): void
navigateTabs(direction: 'prev' | 'next'): void
reopenLastClosed(): void
pinTab(tabId: string): void

// State
tabs: Tab[]
activeTab: Tab | null
```

**Comportement fermeture :**
- Si fermeture de l'onglet actif → activer le voisin de droite (ou gauche si dernier)
- Si dernier onglet fermé → afficher écran "Ouvrir une session"
- Tab fermé → pushé dans `closedTabsHistory` (max 10)

**Comportement ouverture :**
- `openTab(session)` : si session déjà ouverte → activer son onglet existant
- Sinon → créer nouvel onglet et l'activer

### 5.2 useTabKeyboard (`hooks/useTabKeyboard.ts`)

```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (!e.altKey) return

    switch (true) {
      case e.key === 't':
        e.preventDefault()
        openNewSessionPicker()
        break
      case e.key === 'w':
        e.preventDefault()
        closeTab(activeTab.id)
        break
      case e.key === 'ArrowLeft':
        e.preventDefault()
        navigateTabs('prev')
        break
      case e.key === 'ArrowRight':
        e.preventDefault()
        navigateTabs('next')
        break
      case e.key === 'T' && e.shiftKey:  // Alt+Shift+T
        e.preventDefault()
        reopenLastClosed()
        break
      case /^[1-9]$/.test(e.key):
        e.preventDefault()
        activateTabByIndex(parseInt(e.key) - 1)
        break
    }
  }

  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [activeTab, tabs])
```

### 5.3 TabBar (`components/tabs/TabBar.tsx`)

**Layout:**
```
┌──────────────────────────────────────────────────┐
│ [🤖 James] [x]  [💬 Max] [x]  [+]    [≡ menu]  │
└──────────────────────────────────────────────────┘
```

**Comportements UI :**
- Scroll horizontal si trop d'onglets (pas de retour à la ligne)
- Clic molette sur onglet → fermer
- Double-clic sur onglet → renommer (inline edit)
- Drag & drop pour réordonner (optionnel, phase 2)
- Tooltip au hover avec le nom complet si tronqué
- Indicateur unread : point orange sur l'onglet

**Overflow :**
- Si > 10 onglets → afficher bouton `≡` avec dropdown liste complète
- Onglets épinglés toujours visibles, non scrollables

### 5.4 Modifications de page.tsx

**Avant :** `selectedSession` géré localement dans page.tsx  
**Après :** `activeTab` vient du TabContext

```typescript
// Remplacer
const [selectedSession, setSelectedSession] = useState<Session | null>(null)

// Par
const { activeTab, openTab } = useTab()
const selectedSession = activeTab ? sessions.find(s => s.sessionKey === activeTab.sessionKey) : null
```

page.tsx perd ~200 lignes de gestion de state de session.

---

## 6. Migration depuis la Sidebar

**Ce qui disparaît :**
- `SessionsSidebar` component (remplacé par `TabBar`)
- State `isSidebarOpen` / `sidebarWidth`
- Layout flex avec sidebar gauche

**Ce qui reste :**
- Panel "New Chat" (accessible via `Alt+T`)
- Panel "New Group"
- Logique de chargement des sessions (inchangée)

**Layout après migration :**
```
┌──────────────────────────────────────┐
│ TabBar (onglets)                      │
├──────────────────────────────────────┤
│ ChatHeader (session active)           │
├──────────────────────────────────────┤
│                                       │
│ MessageList (flex-1)                  │
│                                       │
├──────────────────────────────────────┤
│ ChatInput                             │
└──────────────────────────────────────┘
```

---

## 7. Tests à écrire

```typescript
// __tests__/tab-manager.test.ts
describe('TabContext', () => {
  it('opens a new tab for a session')
  it('activates existing tab if session already open')
  it('closes active tab and activates neighbor')
  it('pushes closed tab to history (max 10)')
  it('reopens last closed tab')
  it('persists tabs to localStorage')
  it('recovers from corrupted localStorage')
})

// __tests__/components/tab-bar.test.tsx
describe('TabBar', () => {
  it('renders all open tabs')
  it('marks active tab')
  it('shows unread indicator')
  it('closes tab on click x')
  it('shows overflow menu when > 10 tabs')
})

// __tests__/hooks/useTabKeyboard.test.ts
describe('useTabKeyboard', () => {
  it('Alt+T triggers openNewSessionPicker')
  it('Alt+W closes active tab')
  it('Alt+ArrowLeft navigates to previous tab')
  it('Alt+ArrowRight navigates to next tab')
  it('Alt+Shift+T reopens last closed tab')
  it('Alt+1 activates first tab')
})
```

---

## 8. Ordre d'implémentation

1. **TabContext** + types + localStorage persistence
2. **useTabKeyboard** hook
3. **TabBar** + **TabItem** composants (UI only, no logic)
4. **Brancher TabContext dans page.tsx** (remplacer selectedSession)
5. **Supprimer SessionsSidebar** + adapter layout
6. **Tests** — viser 100% sur TabContext et useTabKeyboard
7. **TabOverflowMenu** (si > 10 tabs)
8. **Polish** — drag & drop, inline rename (optionnel)

**Estimation :** 2-3 jours dev solo.

---

## 9. Non-goals (hors scope)

- Sync des onglets entre plusieurs fenêtres/navigateurs
- Onglets avec contenu différent du chat (file manager dans un tab, etc.) — pour plus tard
- Animations de transition entre onglets — peut être ajouté facilement après

---

## 10. Notifications de réponse

### Comportement attendu

Quand un agent répond dans un onglet **non actif** :
1. **Point orange** sur l'onglet (indicateur `hasUnread`)
2. **Badge numérique** si plusieurs messages non lus (optionnel)
3. **Notification système** (browser Notification API) si l'onglet du navigateur est en arrière-plan
4. **Titre de page** mis à jour : `(1) Claos` → `(3) Claos`

### Implémentation

#### State

```typescript
interface Tab {
  // ...existant
  hasUnread: boolean
  unreadCount: number       // nouveau
  lastMessageAt?: number    // timestamp du dernier message reçu
}
```

#### Marquer comme lu

```typescript
// Dans TabContext
function activateTab(tabId: string) {
  setTabs(prev => prev.map(t =>
    t.id === tabId
      ? { ...t, isActive: true, hasUnread: false, unreadCount: 0 }
      : { ...t, isActive: false }
  ))
}
```

#### Incrémenter les unread

```typescript
// Appelé quand un message arrive sur une session
function markTabUnread(sessionKey: string) {
  setTabs(prev => prev.map(t => {
    if (t.sessionKey !== sessionKey) return t
    if (t.isActive && document.visibilityState === 'visible') return t // tab active + visible → pas d'unread
    return { ...t, hasUnread: true, unreadCount: (t.unreadCount ?? 0) + 1 }
  }))
}
```

#### Notification système

```typescript
// hooks/useTabNotifications.ts
export function useTabNotifications() {
  const requestPermission = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission()
    }
  }

  const notify = (agentName: string, preview: string, onClick: () => void) => {
    if (document.visibilityState === 'visible') return // app en premier plan → pas de notif système
    if (!('Notification' in window) || Notification.permission !== 'granted') return

    const notif = new Notification(`${agentName} a répondu`, {
      body: preview.slice(0, 100),
      icon: '/favicon.ico',
      tag: agentName, // remplace la notif précédente du même agent
    })

    notif.onclick = () => {
      window.focus()
      onClick()
    }
  }

  return { requestPermission, notify }
}
```

#### Titre de page dynamique

```typescript
// Dans TabContext ou un hook dédié
useEffect(() => {
  const totalUnread = tabs.reduce((sum, t) => sum + (t.unreadCount ?? 0), 0)
  document.title = totalUnread > 0
    ? `(${totalUnread}) Claos`
    : 'Claos'
}, [tabs])
```

### UX détails

- **Demander la permission** de notification au premier login (une seule fois, mémoriser le refus)
- **Preview tronquée** à 100 chars dans la notification système
- **Tag unique par agent** → une seule notif système à la fois par agent, pas de spam
- **Clic sur la notif** → focus sur la fenêtre + activation de l'onglet correspondant
- **Visibility API** → ne pas notifier si l'app est visible et l'onglet actif

### Tests à ajouter

```typescript
describe('Tab notifications', () => {
  it('marks tab unread when message arrives on inactive tab')
  it('does NOT mark unread when tab is active and page is visible')
  it('resets unread count on tab activation')
  it('updates document.title with unread count')
  it('fires system notification when page is hidden')
  it('does not fire system notification when page is visible')
})
```

---

*Plan créé le 2026-02-18 — Notifications ajoutées le 2026-02-18*
