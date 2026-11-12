import type { ReactNode } from 'react'

/**
 * The revision-checked selection exposed by dsh's composer.
 * dsh 输入框提供的带草稿版本校验的选区。
 */
type Insertion = { readonly __tokenSpan: unique symbol }

/**
 * Native draft actions. Insertion returns false when the captured draft has changed.
 * 原生草稿操作。捕获的草稿发生变化时，插入返回 false。
 */
export interface InputActions {
  captureInsertion(): Insertion
  insertText(text: string, span: Insertion): boolean
}

/**
 * The subset of the dsh client contract used by the settings and composer entries.
 * 设置页与输入框条目使用的 dsh 客户端契约子集。
 */
export interface ClientContext {
  effect(run: () => () => void, label?: string): void
  on(event: 'connection/reset', listener: () => void): () => void
  readonly locale: {
    register(namespace: string, labels: Record<string, Record<string, string>>): () => void
    bind(namespace: string): (key: string) => string
  }
  readonly slots: {
    inject(name: string, register: () => () => void): void
    entries(name: 'sidebar.settings'): readonly { readonly store?: {
      create(): { readonly actions: { openSection(id: string): void } }
    } }[]
    register(options: {
      readonly name: 'settings.section'
      readonly id: string
      readonly order: number
      readonly label: () => string
      readonly locale: string
    }, render: (props: { readonly t: (key: string) => string }) => ReactNode): () => void
    register(options: {
      readonly name: 'settings.section.icon'
      readonly id: string
    }, render: (props: { readonly size: number }) => ReactNode): () => void
    register(options: {
      readonly name: 'conversation.input.right'
      readonly id: string
      readonly order: number
      readonly locale: string
    }, render: (props: {
      readonly sessionId: string
      readonly inputActions: InputActions
      readonly t: (key: string) => string
    }) => ReactNode): () => void
  }
}
