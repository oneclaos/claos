# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | ✅        |

## Reporting a Vulnerability

If you discover a security vulnerability in Claos, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

1. Email: open a private GitHub security advisory at https://github.com/e-cesar9/claos-dashboard/security/advisories/new
2. Include: description, steps to reproduce, potential impact, suggested fix (if any)
3. We aim to respond within 72 hours

## Security Architecture

- Authentication: bcrypt (12 rounds) + optional TOTP 2FA
- Session management: signed cookies with httpOnly, Secure, SameSite flags
- CSRF protection: double-submit token pattern with timing-safe comparison
- Rate limiting: 5 failed attempts → 15 min lockout
- File system: path traversal protection via realpath() + allowlist
- Terminal: authenticated access only, per-user session limits
- Headers: CSP with nonce, HSTS, X-Frame-Options DENY, X-Content-Type-Options

## Threat Model

Claos is designed for **self-hosted, single-user or trusted team deployments**. It is NOT designed for:
- Multi-tenant deployments with untrusted users
- Public-facing deployments without additional hardening (WAF, VPN, etc.)
- Environments where terminal access must be restricted
