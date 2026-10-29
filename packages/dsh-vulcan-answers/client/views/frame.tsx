/** Shared frame, copy action and helpers of the component views. Ported from VulcanCode `answer-frame.tsx`. */

import { Check, Copy } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import type { Key, Translate } from '../i18n'

/** What every view receives from the overlay. */
export interface ViewHost {
  readonly t: Translate
  /** Render a container body with dsh's own Markdown renderer. */
  readonly renderMarkdown: (body: string) => ReactNode
}

/** Copy text to the clipboard; rejects when the browser denies it. */
export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}

/** Framed tabular block whose copy-as-Markdown action appears on hover. */
export function Frame({ children, copy, host }: { children: ReactNode; copy: string; host: ViewHost }) {
  return (
    <section className="vda-figure" data-hover-actions="true">
      <span className="vda-figure-hover">
        <CopyAction host={host} label="copyMarkdown" text={copy} />
      </span>
      {children}
    </section>
  )
}

/** Icon button that copies `text` and briefly confirms. */
export function CopyAction({ host, label, text }: { host: ViewHost; label: Key; text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timer = window.setTimeout(() => { setCopied(false) }, 1200)
    return () => { window.clearTimeout(timer) }
  }, [copied])
  const title = copied ? host.t('copied') : host.t(label)
  return (
    <button aria-label={title} className="vda-icon-button" title={title} type="button"
      onClick={() => {
        setCopied(false)
        copyText(text).then(() => { setCopied(true) }, () => { setCopied(false) })
      }}>
      {copied ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
    </button>
  )
}

/** Serialize a header and rows as a GitHub Markdown table; pipes and line breaks inside cells are escaped. */
export function markdownTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.map((cell) => cell.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ')).join(' | ')} |`
  return [line(header), `|${' --- |'.repeat(header.length)}`, ...rows.map(line), ''].join('\n')
}

/** Compact display text for one number. */
export function formatNumber(value: number): string {
  return Number(value.toPrecision(6)).toLocaleString()
}
