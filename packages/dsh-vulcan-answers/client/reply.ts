/**
 * The reader's answers to `ui-decision` components and the composers that take them.
 *
 * The composer pill registers its session's composer (its element and dsh's `InputActions`). A
 * decision finds its composer by walking up from its own element to the nearest ancestor that also
 * contains a registered composer, which is the conversation pane both live in. Picks are kept per
 * composer, so every decision answered in one conversation goes into one summary. Nothing is ever
 * sent on its own: only the reader's click inserts the summary into the draft or submits it.
 */

import { formatDecisionReply, type DecisionReply } from '../src/reply-format'
import type { InputActions } from './dsh-client'

/** One registered composer. */
export interface Composer {
  readonly sessionId: string
  readonly element: Element
  readonly actions: InputActions
}

/** Decisions answered in one conversation, in the order they were first answered. */
export class DecisionStore {
  private readonly entries = new Map<string, DecisionReply>()
  private readonly listeners = new Set<() => void>()
  private version = 0

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Changes on every write, for `useSyncExternalStore`. */
  readonly getVersion = (): number => this.version

  get(key: string): DecisionReply | undefined {
    return this.entries.get(key)
  }

  get size(): number {
    return this.entries.size
  }

  /** Replace or, with null, remove one decision; an updated decision keeps its place. */
  set(key: string, entry: DecisionReply | null): void {
    if (entry) this.entries.set(key, entry)
    else if (!this.entries.delete(key)) return
    this.changed()
  }

  /**
   * Put every answered decision into the composer's draft, then submit it when `send` is set. Keeps
   * the entries and returns false when the composer refused the text.
   */
  deliver(composer: Composer, send: boolean, labels: Parameters<typeof formatDecisionReply>[1]): boolean {
    if (this.entries.size === 0) return false
    const text = formatDecisionReply([...this.entries.values()], labels)
    if (!composer.actions.insertText(text, composer.actions.captureInsertion())) return false
    this.entries.clear()
    this.changed()
    if (send) composer.actions.submit()
    return true
  }

  private changed(): void {
    this.version += 1
    for (const listener of [...this.listeners]) listener()
  }
}

/** Registered composers and one decision store per session. */
export class ReplyHub {
  private readonly composers = new Set<Composer>()
  private readonly stores = new Map<string, DecisionStore>()
  private readonly listeners = new Set<() => void>()
  private version = 0

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getVersion = (): number => this.version

  /** Register a mounted composer; returns its removal. */
  register(composer: Composer): () => void {
    this.composers.add(composer)
    this.changed()
    return () => {
      if (this.composers.delete(composer)) this.changed()
    }
  }

  /** The composer of the conversation that shows `element`, if one is on screen. */
  composerFor(element: Element): Composer | undefined {
    const live = [...this.composers].filter((composer) => composer.element.isConnected)
    for (let node: Element | null = element.parentElement; node !== null; node = node.parentElement) {
      const found = live.find((composer) => node.contains(composer.element))
      if (found) return found
    }
    return undefined
  }

  /** The decision store of one session. */
  storeFor(sessionId: string): DecisionStore {
    let store = this.stores.get(sessionId)
    if (store === undefined) {
      store = new DecisionStore()
      this.stores.set(sessionId, store)
    }
    return store
  }

  private changed(): void {
    this.version += 1
    for (const listener of [...this.listeners]) listener()
  }
}
