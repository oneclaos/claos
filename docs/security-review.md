# Claos - Security Review Report

**Date:** 2026-01-29  
**Reviewer:** James (AI)  
**Status:** Architecture review (code non implémenté)

---

## 🟢 Points Positifs

### 1. Isolation Réseau
- **Localhost binding** (127.0.0.1) = pas d'exposition directe
- **SSH tunnel obligatoire** = double auth (SSH + app)
- Attaquant doit d'abord compromettre SSH

### 2. Principe du Moindre Privilège
- Read-only by design
- Pas de shell exec prévu
- Pas d'accès root
- Pas de modification fichiers

### 3. Auth Design
- Bcrypt (cost 12) = résistant brute force
- Session token random (32 bytes)
- Rate limiting prévu
- Timing-safe comparison

---

## 🟡 Points à Améliorer

### 1. PM2/Systemctl Status
**Problème:** L'archi mentionne "PM2 status" et "systemctl" - comment les lire sans exec?

**Risque:** Si on utilise `exec('pm2 list')`, on réintroduit le shell.

**Solution:**
```typescript
// PM2 a une API programmatique
import pm2 from 'pm2'
pm2.connect(() => {
  pm2.list((err, list) => { /* ... */ })
})

// Pour systemctl, lire les fichiers directement
// /run/systemd/system/*.service
// Ou accepter de ne pas avoir cette feature
```

### 2. Log Viewer
**Problème:** Quels logs? Où?

**Risque:** 
- Path traversal si l'utilisateur peut choisir le fichier
- Lecture de fichiers sensibles (/etc/shadow, .env, etc.)

**Solution:**
```typescript
// Whitelist stricte de fichiers
const ALLOWED_LOGS = [
  '/var/log/syslog',
  '/var/log/auth.log',
  '/home/clawd/.pm2/logs/*.log'
]
// Valider que le path demandé est dans la whitelist
// Pas de paramètres utilisateur dans le path
```

### 3. Session Storage
**Problème:** Sessions stockées où? Fichier JSON mentionné.

**Risque:** Si fichier world-readable, leak des sessions.

**Solution:**
- Fichier avec permissions 600
- Ou utiliser un store en mémoire (perd sessions au restart)
- Ou Redis si dispo

### 4. Password Storage
**Problème:** `.env.local` contient le hash bcrypt?

**Risque:** Si `.env.local` est committé ou lisible, compromis.

**Solution:**
- `.env.local` dans `.gitignore` ✅
- Permissions 600 sur le fichier
- Vérifier qu'il n'est pas servi par Next.js

---

## 🔴 Risques Critiques à Mitiger

### 1. Pas de 2FA
**Risque:** Password seul = single point of failure.

**Mitigation:**
- Le SSH tunnel agit comme "premier facteur"
- Acceptable pour usage personnel
- Option: ajouter TOTP plus tard

### 2. Session Fixation
**Risque:** Si token prévisible ou réutilisable.

**Mitigation:**
- `crypto.randomBytes(32)` = 256 bits entropy ✅
- Régénérer token à chaque login
- Invalider à logout

### 3. CSRF
**Risque:** Requêtes cross-site sur les API.

**Mitigation:**
- SameSite=Strict sur cookies
- Vérifier Origin header
- Toutes les mutations en POST

### 4. Pas d'Audit sur Échecs
**Risque:** Pas de visibilité sur tentatives d'attaque.

**Mitigation:**
- Logger TOUS les login failed avec IP
- Alerter après N échecs

---

## 📋 Checklist Implémentation

| Item | Priorité | Status |
|------|----------|--------|
| Bind 127.0.0.1 only | CRITIQUE | ⏳ |
| Aucun exec/spawn | CRITIQUE | ⏳ |
| Bcrypt password | CRITIQUE | ⏳ |
| Rate limiting | HAUTE | ⏳ |
| Session random + expiry | HAUTE | ⏳ |
| Audit logging | HAUTE | ⏳ |
| Security headers | MOYENNE | ⏳ |
| Log whitelist | HAUTE | ⏳ |
| PM2 API (pas exec) | HAUTE | ⏳ |
| .env.local permissions | HAUTE | ⏳ |
| CSRF protection | MOYENNE | ⏳ |

---

## 🎯 Recommandations Finales

1. **Implémenter sans AUCUN child_process** - C'est la règle #1
2. **PM2 API programmatique** ou abandonner cette feature
3. **Whitelist stricte** pour les logs
4. **Tester le binding** - vérifier que 0.0.0.0 est impossible
5. **Review le code** avant deploy - pas d'exec() caché

---

## Verdict

**Architecture: SOLIDE** si implémentée correctement.

**Risque principal:** Que l'implémentation dévie de l'archi et réintroduise du shell exec.

**Recommandation:** Implémenter feature par feature, review chaque PR, tester le binding localhost avant mise en prod.
