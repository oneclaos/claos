# Claos - Product Brief (v2)

## Vision
Dashboard unifié pour gérer et discuter avec tous les agents Clawdbot du VPS depuis une seule interface.

## Problem Statement
Plusieurs agents tournent sur le VPS. Actuellement il faut switch entre Telegram, Discord, etc. pour parler à chacun. Besoin d'une interface unique.

## Target Users
- **Primary**: Rico (owner des agents)

## Core Features

### 1. Vue Agents
- Liste de tous les agents actifs sur le VPS
- Status de chaque agent (online/offline)
- Dernière activité

### 2. Conversations
- Historique des conversations par agent
- Vue multi-colonnes ou tabs (pas besoin de switch fenêtre)
- Scroll infini sur l'historique

### 3. Chat
- Envoyer un message à n'importe quel agent
- Réponse en temps réel (streaming si dispo)
- Support markdown dans les réponses

## Non-Requirements
- ❌ Pas de terminal/shell
- ❌ Pas d'accès système
- ❌ Pas de gestion des users VPS
- ❌ Pas de modification de config agents

## Security

### Accès
- Localhost only (127.0.0.1)
- SSH tunnel obligatoire
- Auth par password (bcrypt)

### Données
- Read-only sur les sessions existantes
- Send message via Gateway API
- Pas d'accès direct aux fichiers agents

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claos UI                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ Agent 1  │ │ Agent 2  │ │ Agent 3  │ │ Agent N  │      │
│  │ [chat]   │ │ [chat]   │ │ [chat]   │ │ [chat]   │      │
│  │ history  │ │ history  │ │ history  │ │ history  │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Clawdbot Gateway                          │
│  - sessions_list                                            │
│  - sessions_history                                         │
│  - sessions_send                                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│ Agent 1  │ │ Agent 2  │ │ Agent N  │
└──────────┘ └──────────┘ └──────────┘
```

## Tech Stack
- **Frontend**: Next.js + React + shadcn/ui
- **Backend**: Next.js API routes → Clawdbot Gateway
- **Auth**: bcrypt + secure sessions
- **Realtime**: Polling ou WebSocket si dispo

## API Integration

Utilise les outils Clawdbot existants:
- `sessions_list` → Liste agents + derniers messages
- `sessions_history` → Historique conversation
- `sessions_send` → Envoyer message à un agent

## UI Mockup

```
┌─────────────────────────────────────────────────────────────┐
│  ☁️ Claos                              [Rico] [Logout] │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│ │ 🤖 James    │ │ 🎮 GameBot  │ │ 📊 DataBot  │            │
│ │ ● Online    │ │ ● Online    │ │ ○ Offline   │            │
│ ├─────────────┤ ├─────────────┤ ├─────────────┤            │
│ │ Rico: salut │ │ Rico: stats │ │ Last: 2d ago│            │
│ │ James: Hey! │ │ Game: voici │ │             │            │
│ │ ...         │ │ ...         │ │             │            │
│ │             │ │             │ │             │            │
│ ├─────────────┤ ├─────────────┤ ├─────────────┤            │
│ │ [Message...│ │ [Message...│ │ [Offline]   │            │
│ └─────────────┘ └─────────────┘ └─────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

## Success Metrics
- Voir tous les agents en un coup d'œil
- Répondre à n'importe quel agent en < 2 clics
- Zero latence perceptible
