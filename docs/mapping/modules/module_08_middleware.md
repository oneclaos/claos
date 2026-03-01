# Module: Middleware (`middleware.ts`)

## Rôle

Edge Runtime request interceptor that enforces authentication, CSRF pre-validation, security headers (CSP with nonce, HSTS, X-Frame-Options, etc.), HTTPS redirect, and route-based auth exemptions for every request.

## Responsabilités principales

- **Auth enforcement**: checks `claos_session` cookie; redirects to `/login` for pages, returns 401 for API routes
- **Session format pre-validation**: 64-char hex format check; deletes malformed session cookie
- **CSRF pre-validation**: for POST/PUT/DELETE/PATCH on protected routes, checks `x-csrf-token` header exists and matches `\w+\.\w+` format (format-only check, NOT HMAC verification)
- **CSP nonce**: generates a 128-bit random nonce per request using `globalThis.crypto` (Edge-safe); embeds in `Content-Security-Policy` header; passes nonce to Next.js via `x-nonce` request header
- **Security headers**: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`
- **HTTPS redirect**: only when `NODE_ENV=production` AND `FORCE_HTTPS=true` AND `x-forwarded-proto` header is not https
- **Legacy redirects**: `/chat`, `/conversations` → `/`; `/dashboard` → `/status`
- **Public routes**: bypasses auth for `/login`, `/setup`, `/first-run`, `/api/auth`, `/api/first-run`, `/api/health`, `/api/csp-report`
- **Static file exclusion**: matcher excludes `_next/static`, `_next/image`, image files, `favicon.ico`

## Dépendances internes

- None (Edge Runtime cannot import Node.js modules)

## Dépendances externes

- `next/server` — `NextRequest`, `NextResponse`
- `globalThis.crypto` — Web Crypto API (Edge-safe nonce generation)

## Ce qui dépend de lui

- Every incoming HTTP request to the app (the middleware runs before all routes)

## Flux de données entrants

- HTTP request (URL, method, cookies, headers)

## Flux de données sortants

- Modified request (with `x-nonce` header) + security response headers
- 401/403 JSON responses for unauthorized/CSRF-failed API requests
- 302 redirects for unauthenticated page requests or legacy URLs

## Risques / Couplages forts

1. **CSRF validation is incomplete in middleware** — middleware only checks token FORMAT (`^\w+\.\w+$`), NOT the HMAC signature. The actual HMAC validation happens in each individual API route handler. This means:
   - The middleware CSRF list gives a false sense of "CSRF protection at the edge"
   - A route that validates the HMAC would still be accessible with a malformed-but-format-valid fake token through the middleware
   - `/api/chat/stream` validates CSRF in its handler but is NOT in `csrfProtectedRoutes` — so the middleware does not pre-check it

2. **CSP uses `unsafe-eval`** — required for `highlight.js`. This weakens the CSP and allows `eval()`-based XSS if any injection point is found. The comment acknowledges this is acceptable for an internal tool, but it should be documented as a known exception.

3. **Session validation is format-only in middleware** — the middleware checks that the cookie is 64 hex chars but does NOT call `validateSession()` (which would check the sessions file). The full validation happens in each API route. This means:
   - A session token can be format-valid but expired/revoked, and the middleware will forward the request
   - Pages will show loading state briefly before the route handler rejects the session

4. **`csrfProtectedRoutes` list is manually maintained** — it must be updated every time a new mutating API route is added. The comment says "keep exhaustive" but there is no compile-time enforcement.

5. **Edge Runtime limitation** — because middleware runs in the Edge Runtime, it cannot do crypto operations using Node.js `crypto` (uses Web Crypto instead). This means it cannot fully validate CSRF tokens (which require `createHash` from `node:crypto`). This is an inherent architectural constraint of using Edge middleware for auth.

## Architecture Improvements

- **Move full CSRF validation to a reusable helper** — create `lib/csrf-server.ts` (non-Edge) that both middleware and route handlers can use. Middleware can't do it, but standardizing the route-level validation prevents inconsistencies.
- **Add `/api/chat/stream` to `csrfProtectedRoutes`** even if the route validates CSRF itself — ensures the middleware provides consistent pre-screening.
- **Use route groups for auth** — Next.js App Router supports protected route groups that can apply auth at a layout level, which is more declarative than the middleware list.
- **Document the `unsafe-eval` exception** — track as a known security exception with a ticket/issue reference in the CSP comment.
