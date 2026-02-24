# Claos - Spécifications Techniques

## Architecture des Sessions

### Sessions Directes (1-1)

- Chaque conversation lancée crée UNE session unique
- Session liée à UN gateway (agent)
- ID unique: `claos-{gatewayId}-{timestamp}`

### Sessions de Groupe (Multi-agent)

- Une conversation de groupe crée UNE session de groupe
- Sessions dédiées pour chaque gateway d'agent dans le groupe
- ID unique: `claos-multiagent-{timestamp}`
- `gatewayIds[]` contient tous les IDs des gateways participants
- Les agents DOIVENT pouvoir se parler entre eux

## Stockage

### IndexedDB (PAS localStorage!)

- **Toutes les données** doivent être stockées en IndexedDB
- Sessions
- Messages
- Historiques
- Configuration

### Isolation des Données

- Chaque conversation a son propre **ID de requête**
- Le frontend gère les IDs de requête
- Les historiques de messages ne doivent JAMAIS s'entremêler
- Filtrage par ID de requête côté frontend

## UI Control

### Navigation

- UI Control déclenche la navigation dans l'interface
- Fonctionne dans les conversations avec 1 ou plusieurs agents

### Exécution des Commandes

- Le **premier agent** à intercepter une commande UI l'exécute
- Une fois exécutée, la commande est **kill** (pas de double exécution)
- Mécanisme de lock/flag pour éviter les race conditions

## Flow des Messages

### Envoi

1. Frontend génère un ID de requête unique
2. Message envoyé à la/les gateway(s)
3. ID de requête attaché à la requête

### Réception

1. Réponse arrive avec l'ID de requête
2. Frontend filtre par ID de requête
3. Message affiché dans la bonne conversation

### Multi-agent

1. Message envoyé à tous les gateways du groupe
2. Chaque agent répond
3. Les réponses sont agrégées par ID de requête
4. Affichage dans la conversation de groupe

## Règles Critiques

1. **Pas de mélange** - Chaque session est isolée
2. **IndexedDB only** - Pas de localStorage pour les données persistantes
3. **ID de requête** - Toujours présent, toujours vérifié
4. **First-to-execute** - UI Control: premier arrivé, premier servi, puis kill
5. **Gateway dédié** - Chaque agent a sa propre connexion gateway

---

_Dernière mise à jour: 2026-02-23_
