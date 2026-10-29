/**
 * `@deepseek-ai/dsh-client-ui-primitives` as dsh's page module table serves it; only `MarkdownText` is
 * used. Restated from `packages/client/ui-primitives/src/markdown/MarkdownText.tsx`.
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { NamedExoticComponent } from 'react'

  export const MarkdownText: NamedExoticComponent<{
    text: string
    streaming?: boolean
    labels: unknown
    fileMentions?: unknown
    pathImages?: unknown
    variant?: 'body' | 'compact'
  }>
}
