/**
 * The parts of dsh's browser runtime this client half uses.
 *
 * dsh serves these modules from its page module table; their packages are not published at the
 * Host's version, so the shapes are restated here from dsh 0.2.1-rc.2 and must be checked again when
 * the supported dsh range moves:
 * - `packages/client/ui-conversation/src/client/contract/{slots,input}.ts` (`conversation.input.right`, `InputActions`)
 * - `packages/client/ui-shell` (`shell.overlay`, a root list slot)
 * - `packages/client/ui-primitives/src/markdown/{MarkdownText,render}.tsx` (`MarkdownText`, `MarkdownLabels`)
 * - `packages/client/locale/src/client/index.ts` (`bind`)
 * - `packages/client/ui-session/src/client/index.ts` (`sessionId`, `useProjection` props)
 * - `packages/api/session-controller/src/client/contract/{sessions,session}.ts` (`binding`, `command`)
 * - `packages/client/ui-settings/src/client/config-form-types.ts` (`ConfigForm`)
 */

import type { ReactNode } from 'react'

/** Host operation result as the Remote layer returns it. */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** Opaque, revision-guarded editor selection. */
export type TokenSpan = { readonly __tokenSpan: unique symbol }

/** Public composer actions of one session; only the members used here. */
export interface InputActions {
  captureInsertion(): TokenSpan
  /** @returns false when the draft changed or submission locked the editor. */
  insertText(text: string, span: TokenSpan): boolean
  submit(): void
}

/** Props of a `conversation.input.right` entry; only the fields read here. */
export interface InputSlotProps {
  readonly sessionId: string
  readonly useProjection: (key: string) => unknown
  readonly inputActions: InputActions
  readonly t: (key: string) => string
}

/** Accepted Host values of one configuration namespace. */
export interface ConfigFormSnapshot<T> {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value: T | undefined
}

/** Reads of one plugin entry's configuration namespace; only the members used here. */
export interface ConfigForm<T> {
  getSnapshot(): ConfigFormSnapshot<T>
  subscribe(listener: () => void): () => void
}

/** Localized chrome dsh's Markdown renderer takes. */
export interface MarkdownLabels {
  readonly code: unknown
  readonly footnotes: string
}

/** The browser plugin context services this client half injects. */
export interface ClientContext {
  effect(execute: () => () => void, label?: string): void
  readonly locale: {
    register(namespace: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>): () => void
    /** The current dictionary of one namespace. */
    bind(namespace: string): (key: string) => string
  }
  readonly slots: {
    inject(name: string, callback: () => () => void): void
    register(
      options: { readonly name: 'shell.overlay'; readonly id: string; readonly locale: string },
      component: (props: { readonly t: (key: string) => string }) => ReactNode,
    ): () => void
    register<I extends object>(
      options: {
        readonly name: 'conversation.input.right'
        readonly id: string
        readonly order?: number
        readonly locale: string
        readonly inject: (sessionId: string) => I
      },
      component: (props: InputSlotProps & I) => ReactNode,
    ): () => void
  }
  readonly sessions: {
    binding(sessionId: string): { readonly session: { command(line: string): Promise<RemoteResult<{ readonly matched: boolean }>> } } | undefined
  }
  readonly configForms: {
    get<T>(entryId: string): ConfigForm<T>
  }
}
