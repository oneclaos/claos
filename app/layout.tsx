import type { Metadata } from 'next'
import { Source_Serif_4 } from 'next/font/google'
import { headers } from 'next/headers'
import './globals.css'

const sourceSerif4 = Source_Serif_4({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-serif',
  weight: ['300', '400', '600', '700'],
})

export const metadata: Metadata = {
  icons: {
    icon: '/icon.svg',
    apple: '/apple-touch-icon.png',
  },
  title: 'Claos',
  description: 'Multi-agent conversation dashboard',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Read the per-request nonce injected by middleware via the x-nonce request
  // header. Next.js App Router reads this header internally and applies the
  // nonce to its own inline hydration scripts, allowing us to remove
  // 'unsafe-inline' from the script-src CSP directive.
  const nonce = (await headers()).get('x-nonce') ?? ''

  return (
    <html lang="en" className={`${sourceSerif4.variable} h-full overflow-hidden`}>
      <head>
        {/*
          Empty script with the nonce attribute. Next.js uses this to
          propagate the nonce to all inline scripts it generates (RSC
          payloads, hydration data, etc.), so they pass the CSP check.
        */}
        {nonce && <script nonce={nonce} />}
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        {/* Satoshi — body font via Fontshare */}
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap"
        />
      </head>
      <body className="antialiased h-full w-full overflow-hidden">
        {children}
      </body>
    </html>
  )
}
