# Specs — Tab Navigation
**Status:** Validé par Rico — 2026-02-18  
**Branche de départ:** `release/v0.1.0`

---

## 1. Concept fondamental

Chaque onglet = **une instance complète du dashboard** (sidebar + contenu).  
Le layout actuel ne change PAS — il est encapsulé dans un système d'onglets.

```
┌──────────────────────────────────────────────────────┐
│ [💬 James] [💻 Terminal] [📁 Files] [💬 Max] [+]    │  ← TabBar
├──────────────┬───────────────────────────────────────┤
│              │                                       │
│   Sidebar    │   Contenu actif dans cet onglet       │
│  (inchangée) │   (chat, terminal, files, status…)    │
│              │                                       │
└──────────────┴───────────────────────────────────────┘
```

**Règle clé :** La sidebar est présente dans chaque onglet. Naviguer dans la sidebar d'un onglet n'affecte pas les autres onglets.

---

## 2. Comportement des onglets

### Ouverture
- `Alt+T` (Option+T sur Mac) → nouvel onglet avec vue complète (sidebar + écran vide)
- Clic `+` dans la TabBar → même effet
- Chaque onglet démarre vide, l'utilisateur navigue où il veut via la sidebar

### Contenu d'un onglet
- L'utilisateur peut naviguer vers n'importe quelle section depuis la sidebar : Chat, Terminal, Files, Status
- Le label de l'onglet reflète ce qui est actif : "James", "Terminal", "Files", "Nouveau"
- Navigation interne à l'onglet = indépendante des autres onglets

### Instances multiples autorisées
- ✅ 2 onglets chat (conversation James + conversation Max)
- ✅ 2 onglets terminal
- ✅ 2 onglets file manager
- ✅ Toute combinaison possible

### Fermeture
- `Alt+W` → ferme l'onglet actif
- Clic `×` sur l'onglet → ferme
- Si dernier onglet fermé → écran vide "Ouvrir un onglet"
- L'onglet fermé est mémorisé pour `Alt+Shift+T`

---

## 3. Raccourcis clavier (desktop uniquement)

| Raccourci | Mac | Action |
|-----------|-----|--------|
| `Alt+T` | `Option+T` | Nouvel onglet |
| `Alt+W` | `Option+W` | Fermer onglet actif |
| `Alt+←` | `Option+←` | Onglet précédent |
| `Alt+→` | `Option+→` | Onglet suivant |
| `Alt+Shift+T` | `Option+Shift+T` | Réouvrir dernier fermé |
| `Alt+1` à `Alt+9` | `Option+1-9` | Aller à l'onglet N |

**Implémentation clavier :** Utiliser `e.code` (ex: `KeyT`, `KeyW`) et non `e.key` pour éviter les conflits avec les caractères spéciaux macOS (Option+T = `†`).

---

## 4. TabBar (UI)

### Apparence
- Barre horizontale fixe en haut du dashboard
- Hauteur : 36px
- Chaque onglet : icône + label tronqué + bouton `×`
- Onglet actif : visuellement distingué (fond blanc, bordure)
- Onglet inactif : fond gris léger
- Scroll horizontal si trop d'onglets (pas de retour à la ligne)
- Bouton `+` à droite des onglets

### Indicateurs de non-lu (chat uniquement)
- Point orange sur l'onglet si un message est arrivé sur une session inactive
- Badge numérique si plusieurs messages non lus
- Disparaît au clic sur l'onglet

### Overflow
- Si > 10 onglets : bouton `≡` avec dropdown listant tous les onglets

### Icônes par section active
- Chat → 💬
- Terminal → 💻
- Files → 📁
- Status → 📊
- Nouveau (vide) → ⊕

---

## 5. Notifications

### Unread dans les onglets chat
- Un message arrive sur une session dans un onglet inactif → point orange + badge count
- L'onglet actif ne reçoit pas de badge (déjà visible)
- Cliquer sur l'onglet → reset le badge

### Titre de page
- `(3) Claos` si 3 messages non lus en total
- `Claos` si rien

### Notification système (browser Notification API)
- Uniquement si la fenêtre est en arrière-plan
- `requestPermission()` au premier login
- Tag unique par agent → une seule notif à la fois par agent (pas de spam)
- Clic sur notif → focus window + active l'onglet correspondant

---

## 6. Mobile

**Pas d'onglets sur mobile.**

- La TabBar est masquée sur écrans < 768px
- Le layout mobile reste celui de `v0.1.0` (inchangé)
- Pas de gestion de raccourcis clavier sur mobile
- Les notifications badge restent actives (point orange dans la nav mobile si applicable)

---

## 7. Persistence

### localStorage (clé `claos_tabs`, schema v1)
```typescript
{
  version: 1,
  tabs: Tab[],
  activeTabId: string | null
}
```

### Migration
- Si localStorage absent/corrompu → démarrer avec 1 onglet vide
- Validation Zod au chargement, purge si invalide

### Survie au refresh
- Les onglets ouverts sont restaurés au rechargement
- L'onglet actif au moment du reload est réactivé
- La section active dans chaque onglet est restaurée (view + sessionKey si chat)

---

## 8. État interne d'un onglet

```typescript
type TabView = 'empty' | 'chat' | 'terminal' | 'files' | 'status'

interface Tab {
  id: string
  view: TabView
  label: string           // "James", "Terminal", "Files", "Nouveau"
  sessionKey?: string     // si view === 'chat'
  gatewayId?: string      // si view === 'chat'
  isPinned: boolean
  isActive: boolean
  hasUnread: boolean
  unreadCount: number
  openedAt: number
}
```

La sidebar d'un onglet appelle `navigateActiveTab(view, opts)` au lieu de `router.push()`.  
Les URLs directes (`/files`, `/terminal`) restent fonctionnelles pour les deep links.

---

## 9. Ce qui NE change PAS

- La sidebar (icônes, sections, comportement) — identique à v0.1.0
- Le chat (envoi, streaming, groupes multi-agents) — identique
- Le terminal — identique
- Le file manager — identique
- L'auth, la sécurité, les API routes — inchangées

---

## 10. Plan d'implémentation (ordre strict)

### Phase 1 — TabContext + TabBar (sans toucher au contenu)
1. `lib/tab-types.ts` — types + Zod schema
2. `context/tab-context.tsx` — state, persistence, fonctions
3. `hooks/useTabKeyboard.ts` — raccourcis Alt/*
4. `components/tabs/TabBar.tsx` + `TabItem.tsx` + `TabOverflowMenu.tsx`
5. Brancher TabBar dans le layout — **le contenu ne change pas encore**
6. Tests TabContext (tout le state machine)
7. ✅ Build + tests verts → commit

### Phase 2 — Navigation interne (sidebar → tab state)
8. Modifier la sidebar pour appeler `navigateActiveTab()` au lieu de `router.push()`
9. Rendu conditionnel dans page.tsx selon `activeTab.view`
10. `WelcomeScreen` pour les onglets vides
11. Tests de navigation
12. ✅ Build + tests verts → commit

### Phase 3 — Notifications
13. `hooks/useTabNotifications.ts` — Notification API
14. `markTabUnread(sessionKey)` branché dans `useMessageSender`
15. Titre de page dynamique
16. Tests notifications
17. ✅ Build + tests verts → commit

### Phase 4 — Mobile
18. Masquer TabBar sur < 768px (`hidden md:flex`)
19. Vérifier que le layout mobile est intact
20. ✅ Build + tests verts → commit final

**Règle absolue :** chaque phase doit compiler et passer les tests avant de passer à la suivante.

---

## 11. Critères d'acceptance

- [ ] `Alt+T` ouvre un nouvel onglet avec sidebar visible
- [ ] Naviguer vers Files dans un onglet n'affecte pas les autres onglets
- [ ] 2 onglets chat côte à côte fonctionnent indépendamment
- [ ] `Alt+W` ferme l'onglet actif, active le voisin
- [ ] `Alt+Shift+T` réouvre le dernier onglet fermé
- [ ] Option+T fonctionne sur Mac (test `e.code`)
- [ ] Onglets persistés au refresh
- [ ] Badge non-lu sur onglet inactif
- [ ] TabBar masquée sur mobile
- [ ] 86+ tests verts, build propre

---

*Specs validées le 2026-02-18*
