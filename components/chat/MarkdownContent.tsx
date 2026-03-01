'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import { useState, useCallback, type ReactNode } from 'react'
import { Copy, Check, Download } from 'lucide-react'

// ── Extract plain text from React nodes (for copy/download) ─────────────────
function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

interface CodeBlockProps {
  language: string | null
  filename: string | null
  // children are already syntax-highlighted React nodes from rehypeHighlight
  children: ReactNode
  rawText: string
}

function CodeBlock({ language, filename, children, rawText }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(rawText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [rawText])

  const handleDownload = useCallback(() => {
    if (!filename) return
    const blob = new Blob([rawText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [rawText, filename])

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-[var(--color-border)] bg-[#0d1117] max-w-full">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          {filename ? (
            <span className="text-xs font-medium text-[#8b949e] font-mono">{filename}</span>
          ) : language ? (
            <span className="text-xs text-[#8b949e] font-mono">{language}</span>
          ) : (
            <span className="text-xs text-[#8b949e]">code</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {filename && (
            <button
              type="button"
              onClick={handleDownload}
              title={`Download ${filename}`}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-md text-[#8b949e] hover:text-white hover:bg-white/10 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            title="Copy code"
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md text-[#8b949e] hover:text-white hover:bg-white/10 transition-colors"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-green-400" />
                <span className="text-green-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
      {/* Code content — children already contain syntax-highlighted spans from rehypeHighlight */}
      <pre className="overflow-x-auto overflow-y-auto max-h-64 p-4 text-sm leading-relaxed m-0 text-white">
        <code className={language ? `language-${language}` : ''}>{children}</code>
      </pre>
    </div>
  )
}

interface MarkdownContentProps {
  content: string
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="markdown-content text-sm leading-relaxed text-[var(--color-text-primary)] overflow-hidden">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // ── Code: block vs inline ────────────────────────────────────────
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          code({ node, className, children, ...props }: any) {
            const isInline = !className && typeof children === 'string' && !children.includes('\n')

            if (isInline) {
              return (
                <code
                  className="px-1.5 py-0.5 rounded-md text-xs font-mono bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] border border-[var(--color-border)]"
                  {...props}
                >
                  {children}
                </code>
              )
            }

            // Block code: extract language + optional filename
            // className is typically "language-tsx" or "language-tsx filename.tsx"
            const rawClass = className ?? ''
            // rehype-highlight sets className like "language-tsx"
            // remark-gfm passes the meta via node.data?.meta
            const meta: string = (node?.data as { meta?: string } | undefined)?.meta ?? ''
            const langMatch = rawClass.match(/language-(\S+)/)
            const language = langMatch ? langMatch[1] : null

            // filename: from meta (e.g. ```tsx App.tsx → meta = "App.tsx")
            const filenameFromMeta = meta.trim() || null
            // Validate it looks like a filename (has extension or is simple word)
            const filename =
              filenameFromMeta && /\S+\.\S+/.test(filenameFromMeta) ? filenameFromMeta : null

            // Extract plain text for copy/download (children are React nodes from rehypeHighlight)
            const rawText = extractText(children).replace(/\n$/, '')

            return (
              <CodeBlock language={language} filename={filename} rawText={rawText}>
                {children}
              </CodeBlock>
            )
          },

          // ── Paragraphs ───────────────────────────────────────────────────
          p({ children }) {
            return <p className="mb-2 last:mb-0 whitespace-pre-wrap">{children}</p>
          },

          // ── Headings ─────────────────────────────────────────────────────
          h1({ children }) {
            return (
              <h1 className="text-lg font-bold mb-3 mt-4 first:mt-0 text-[var(--color-text-primary)]">
                {children}
              </h1>
            )
          },
          h2({ children }) {
            return (
              <h2 className="text-base font-semibold mb-2 mt-3 first:mt-0 text-[var(--color-text-primary)]">
                {children}
              </h2>
            )
          },
          h3({ children }) {
            return (
              <h3 className="text-sm font-semibold mb-2 mt-3 first:mt-0 text-[var(--color-text-primary)]">
                {children}
              </h3>
            )
          },

          // ── Lists ────────────────────────────────────────────────────────
          ul({ children }) {
            return <ul className="list-disc list-inside mb-2 space-y-0.5 pl-2">{children}</ul>
          },
          ol({ children }) {
            return <ol className="list-decimal list-inside mb-2 space-y-0.5 pl-2">{children}</ol>
          },
          li({ children }) {
            return <li className="text-[var(--color-text-primary)]">{children}</li>
          },

          // ── Blockquote ───────────────────────────────────────────────────
          blockquote({ children }) {
            return (
              <blockquote className="border-l-4 border-[var(--color-primary)] pl-3 my-2 text-[var(--color-text-secondary)] italic">
                {children}
              </blockquote>
            )
          },

          // ── Table ────────────────────────────────────────────────────────
          table({ children }) {
            return (
              <div className="overflow-x-auto my-3">
                <table className="w-full text-xs border-collapse border border-[var(--color-border)] rounded-lg overflow-hidden">
                  {children}
                </table>
              </div>
            )
          },
          thead({ children }) {
            return <thead className="bg-[var(--color-bg-elevated)]">{children}</thead>
          },
          th({ children }) {
            return (
              <th className="px-3 py-2 text-left font-semibold text-[var(--color-text-primary)] border-b border-[var(--color-border)]">
                {children}
              </th>
            )
          },
          td({ children }) {
            return (
              <td className="px-3 py-2 text-[var(--color-text-secondary)] border-b border-[var(--color-border)] last:border-b-0">
                {children}
              </td>
            )
          },

          // ── Links ────────────────────────────────────────────────────────
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-primary)] underline underline-offset-2 hover:opacity-80 transition-opacity"
              >
                {children}
              </a>
            )
          },

          // ── Horizontal rule ──────────────────────────────────────────────
          hr() {
            return <hr className="my-3 border-[var(--color-border)]" />
          },

          // ── Strong / Em ──────────────────────────────────────────────────
          strong({ children }) {
            return (
              <strong className="font-semibold text-[var(--color-text-primary)]">{children}</strong>
            )
          },
          em({ children }) {
            return <em className="italic text-[var(--color-text-secondary)]">{children}</em>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
