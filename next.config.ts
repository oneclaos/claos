import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',

  // Security headers for static assets (middleware handles dynamic routes with nonce-based CSP)
  async headers() {
    return [
      {
        // Apply to all static assets
        source: '/:path*',
        headers: [
          // CORS - restrict to same origin only (no cross-origin requests allowed)
          {
            key: 'Access-Control-Allow-Origin',
            value: '', // Empty = no cross-origin access (CORS blocked)
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PUT, DELETE, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-CSRF-Token, X-Request-ID',
          },
          {
            key: 'Access-Control-Allow-Credentials',
            value: 'true',
          },
          // Additional security headers (complement middleware)
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'off',
          },
          {
            key: 'X-Download-Options',
            value: 'noopen',
          },
          {
            key: 'X-Permitted-Cross-Domain-Policies',
            value: 'none',
          },
        ],
      },
    ]
  },
}

export default nextConfig
