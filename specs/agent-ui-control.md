# Spec: Agent UI Control
**Feature:** Contrôle de l'interface Claos par l'agent en temps réel  
**Status:** Draft  
**Date:** 2026-02-19  
**Source:** Brainstorm Telegram Rico × James

---

## 1. Contexte & Vision

Claos tourne en local — l'agent a accès à la machine. L'idée: l'agent ne se contente pas de répondre en texte, il **navigue dans l'app, ouvre des terminaux, tape des commandes** — en direct, sous les yeux de l'user.

Résultat: une expérience type "Devin / Cursor" mais pour ton infra. Tu regardes ton AI bosser pour toi, en transparence totale.

---

## 2. Composants de la Feature

### 2.1 Floating Agent Button

Un bouton persistant accessible depuis toutes les pages de l'app **sauf la vue Chat** (qui a déjà son interface agent).

**Comportement:**
- Position: coin bas-droite (fixed)
- Icône: ⚡
- Click → ouvre un popup/overlay d'activation
- Masqué automatiquement quand la tab active est de type `chat`

**Popup d'activation:**
- Sélecteur d'agent (dropdown) — **auto-select si un seul agent configuré** (skip le dropdown)
- Input texte ou bouton micro pour commande vocale
- Bouton "Lancer" + bouton **Stop** pour interrompre en cours d'exécution

---

### 2.2 UI Control Mode

Quand l'agent est activé via le floating button:

1. **Navigation automatique** — l'agent navigue entre les tabs de l'app
2. **Terminal animé** — la tab Shell s'ouvre, les commandes se tapent lettre par lettre en temps réel
3. **Feedback visuel** — l'user voit exactement ce que l'agent fait
4. **Background execution** — si l'user change de tab pendant l'action, l'action continue sans interruption

**Exemple de flow:**
```
User: "Check les fichiers de mon projet X"
→ Agent navigue vers tab Shell
→ Terminal s'ouvre
→ "cd /home/clawd/prod/projectX" se tape en live (fast: ~20ms/char)
→ "ls -la" se tape
→ Résultat s'affiche
→ Agent résume en texte dans le chat
```

**Si l'user change de tab pendant l'action:**
- L'action se déroule en background
- Le terminal continue de recevoir les keystokes
- Un indicateur visuel (pill "Agent actif ⚡") reste visible dans la UI
- L'user peut revenir voir le résultat à tout moment

---

### 2.3 Architecture Technique

#### Frontend → Agent (Tool Calls)
L'agent reçoit des **tools spéciaux** quand UI Control est activé:

```typescript
navigate_to_tab(tab: "shell" | "files" | "agents" | "settings")
open_terminal()
type_command(command: string)   // animation fast: ~20ms/char
stop()                          // signal d'arrêt (bouton Stop)
show_notification(message: string)
```

Le frontend **écoute les tool calls** et exécute les actions UI correspondantes.

#### Agent → Frontend (WebSocket / SSE)
Stream en temps réel:
- Keystrokes du terminal (lettre par lettre, 20ms/char)
- Navigation events
- Status updates (`running` | `done` | `stopped`)

#### Terminal Frontend
- **Library:** xterm.js (déjà utilisé dans Claos)
- Stream des caractères via WebSocket
- Animation fast: délai fixe 20ms entre les caractères

#### Injection de Contexte (System Prompt)
Quand UI Control est ON, le system prompt inclut:

```
Tu es dans Claos (interface locale).
Tu as accès aux actions UI suivantes:
- navigate_to_tab(tab) — naviguer vers une tab
- open_terminal() — ouvrir un terminal
- type_command(cmd) — taper une commande dans le terminal (animé)
- stop() — arrêter si l'user l'a demandé

Les actions se déroulent en background même si l'user change de tab.
Utilise ces actions pour accomplir les tâches visuellement.
```

---

### 2.4 Toggle "UI Control" dans Settings

**Localisation:** Settings → Agent → UI Control  

**Toggle:**
- **ON** → System prompt étendu injecté + tools UI activés + WebSocket ouvert + floating button visible
- **OFF** → Agent classique, réponses texte uniquement, floating button masqué

**UI du toggle:**
```
┌─────────────────────────────────────┐
│ UI Control                    [ON]  │
│ Permet à l'agent de naviguer dans   │
│ l'app et taper des commandes en     │
│ temps réel.                         │
└─────────────────────────────────────┘
```

---

## 3. Comportements Décidés

| # | Question | Décision |
|---|----------|----------|
| 6.1 | Agent par défaut si un seul configuré ? | Auto-select, skip dropdown |
| 6.2 | Délai animation terminal | **Fast** — ~20ms/char |
| 6.3 | Bouton Stop ? | **Oui** — dans le popup + pill "Agent actif" |
| 6.4 | Changement de tab pendant action ? | **Background** — action continue, indicateur visible |

---

## 4. Sécurité

- **Local only:** Feature pensée pour usage local uniquement, pas multi-tenant
- **Opt-in:** Désactivé par défaut, l'user choisit
- **Scope limité:** L'agent ne peut utiliser que les tools exposés explicitement
- **Pas de prompt injection:** Les commandes passent par des tools structurés, pas du texte libre interprété

---

## 5. Références & Inspiration

- **Cursor** — agent qui contrôle l'éditeur via tool calls
- **Devin** — agent qui navigue dans un browser/IDE en direct
- **Replit Agent** — exécution de code visible en temps réel
- **xterm.js** — terminal frontend dans le browser

---

## 6. Scope MVP

**Inclus:**
- [ ] Floating button ⚡ — masqué dans la vue Chat + masqué si UI Control OFF
- [ ] Auto-select agent si un seul configuré
- [ ] Bouton Stop dans popup + pill "Agent actif ⚡"
- [ ] Background execution (action continue si changement de tab)
- [ ] Toggle UI Control dans Settings
- [ ] Tool: `navigate_to_tab`
- [ ] Tool: `open_terminal`
- [ ] Tool: `type_command` — animation fast 20ms/char
- [ ] Tool: `stop`
- [ ] System prompt injection conditionnel

**Hors scope MVP:**
- Commande vocale (micro)
- Highlight d'éléments UI
- Replay / historique des sessions visuelles
- Multi-agent coordiné dans l'UI
- Délai d'animation configurable

---

*Spec finalisée le 2026-02-19. Prête pour implémentation.*
