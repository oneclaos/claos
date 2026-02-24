# Migration Guide - Senior-Grade Refactor

## Breaking Changes

### 1. Filesystem Allowlist (BREAKING)

**Before:**
```env
# Full filesystem access by default
# ALLOWED_BASE_PATHS=/
```

**After:**
```env
# Restrictive allowlist by default (secure)
# Default: /home,/srv,/var/www,/tmp/claos-data

# To customize:
ALLOWED_BASE_PATHS=/home/myuser,/srv/myapp

# WARNING: Avoid "/" in production
```

**Migration Steps:**
1. Check which paths your agents currently access
2. Set `ALLOWED_BASE_PATHS` explicitly in `.env.local`
3. Test file manager access after upgrade

### 2. Gateway URL Validation (NEW)

**Before:**
- No validation on gateway URLs
- SSRF attacks possible

**After:**
- All gateway URLs validated before requests
- Private IPs blocked in production
- Allowlist enforcement available

**Migration Steps:**
1. If using private IPs (dev only): Set `NODE_ENV=development`
2. For production with custom domains:
   ```env
   ALLOWED_GATEWAY_DOMAINS=mygateway.com,trusted.internal
   ```

### 3. Logging Changes (NON-BREAKING)

**Before:**
```typescript
console.log('Message')
console.error('Error:', err)
```

**After:**
```typescript
import { logger } from '@/lib/logger'

logger.info('Message', { userId: '123' })
logger.error('Error occurred', err, { context: 'details' })
```

**Migration Steps:**
- Optional: Update your code to use structured logger
- Old console.* still works but won't have structured benefits

## New Environment Variables

```env
# Logging
LOG_LEVEL=info  # debug | info | warn | error

# SSRF Protection
ALLOWED_GATEWAY_DOMAINS=example.com,trusted.org  # Optional

# File Manager Security
ALLOWED_BASE_PATHS=/home,/srv,/var/www  # Restrictive by default
```

## Updated Deployment

### Docker Compose

```yaml
services:
  claos:
    environment:
      # Required (unchanged)
      - CLAOS_PASSWORD_HASH=${CLAOS_PASSWORD_HASH}
      - CSRF_SECRET=${CSRF_SECRET}
      - GATEWAYS=${GATEWAYS}
      
      # New (optional)
      - LOG_LEVEL=info
      - ALLOWED_BASE_PATHS=/home,/srv,/var/www
      - ALLOWED_GATEWAY_DOMAINS=mygateway.com
      - NODE_ENV=production
```

### Kubernetes

```yaml
env:
  - name: LOG_LEVEL
    value: "info"
  - name: ALLOWED_BASE_PATHS
    value: "/home,/srv,/var/www"
  - name: ALLOWED_GATEWAY_DOMAINS
    valueFrom:
      configMapKeyRef:
        name: claos-config
        key: gateway-domains
```

## CI/CD Updates

### GitHub Actions

CI/CD pipeline is now automatic on push to `main` or `refactor/**` branches.

**New Workflows:**
- Lint + Type Check
- Unit Tests (70% coverage enforced)
- E2E Tests
- Security Audit (npm audit + Trivy)
- Docker Build

**Pre-commit Hooks:**
- ESLint auto-fix
- Prettier formatting
- Type checking
- Related tests run automatically

### Setup for Developers

```bash
npm install  # Installs husky hooks automatically
```

## Testing

### Running Tests

```bash
# All tests
npm test

# With coverage
npm run test:coverage

# E2E tests
npm run test:e2e

# Watch mode
npm run test:watch
```

### Coverage Requirements

- **Minimum:** 70% (enforced in CI)
- **Branches:** 70%
- **Functions:** 70%
- **Lines:** 70%
- **Statements:** 70%

## Security Improvements

### Before → After

| Feature | Before | After |
|---------|--------|-------|
| **SSRF Protection** | None | ✅ Enabled |
| **Filesystem Access** | Full (/) | Restricted allowlist |
| **Secrets in Logs** | Exposed | ✅ Redacted |
| **Structured Logging** | console.log | ✅ JSON + correlation IDs |
| **Gateway Validation** | None | ✅ URL + domain checks |
| **Test Coverage** | ~20% | ✅ 70%+ enforced |

## Rollback Instructions

If you need to rollback to the previous version:

```bash
git checkout main
git pull origin main

# Or specific commit before refactor
git checkout <commit-hash>

# Restore old .env config if needed
# (remove new env vars, restore ALLOWED_BASE_PATHS=/)
```

## Support

- **Issues:** [GitHub Issues](https://github.com/e-cesar9/claos-dashboard/issues)
- **Documentation:** [README.md](./README.md)
- **Refactor Log:** [REFACTOR_LOG.md](./REFACTOR_LOG.md)
