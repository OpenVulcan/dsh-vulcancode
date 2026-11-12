/**
 * Finds settled `ui-*` code blocks in the chat and keeps one mount per block for the overlay to
 * portal into.
 *
 * dsh renders every fenced block through its `CodeBlock`, whose DOM shows a generic label for
 * languages it cannot highlight, and the info string after the first word never reaches the DOM.
 * The block's language and code are therefore read from the React props of the `CodeBlock` that
 * rendered it, and the full info string from the source text of the enclosing `MarkdownText`. This
 * reads React internals: when the expected fibers or props are missing the block is left alone,
 * so a dsh change degrades to ordinary code blocks instead of failing.
 *
 * Only assistant text is considered (dsh marks its root with `data-streaming`), and only once it has
 * settled; blocks inside a component this plugin rendered (container bodies) are considered too.
 */

import { parseAnswerComponent, SUPPORTED_ANSWER_LANGUAGES, type AnswerComponent } from '../src/answer-model'
import { committedFiberPath, type Fiber } from '../src/committed-fiber'
import { findFenceInfo } from '../src/fences'
import { subscribeBodyInvalidations } from './body-mutations'
import type { MarkdownLabels } from './dsh-client'

/** Attribute that hides an original code block while its component shows. */
export const HIDDEN_ATTRIBUTE = 'data-vulcan-answer-hidden'

/** Attribute of the element a component is portalled into. */
export const ANCHOR_ATTRIBUTE = 'data-vulcan-answer'

/** Props of the enclosing `MarkdownText` a container body reuses. */
export interface MarkdownHost {
  readonly labels: MarkdownLabels
  readonly fileMentions: unknown
  readonly pathImages: unknown
}

/** One rendered component. */
export interface AnswerMount {
  readonly id: number
  readonly anchor: HTMLElement
  readonly language: string
  readonly meta: string
  readonly body: string
  readonly component: AnswerComponent
  readonly markdown: MarkdownHost
}

/** What a block rendered from, as its fibers report it. */
interface BlockSource {
  readonly code: string
  readonly language: string
  readonly streaming: boolean
  readonly text: string | undefined
  readonly markdown: MarkdownHost | undefined
  readonly assistant: boolean
}

/** While a block waits for its message to settle, re-check at least this often (ms). */
const PENDING_RECHECK = 800

/** React's host component tag. */
const HOST_COMPONENT = 5

/** The value stored on \`element\` under the React key with \`prefix\`. */
function reactValue(element: object, prefix: string): unknown {
  for (const key of Object.keys(element)) {
    if (key.startsWith(prefix)) return (element as Record<string, unknown>)[key]
  }
  return undefined
}

/** Props of dsh's `CodeBlock`. */
interface CodeProps {
  readonly code: string
  readonly lang: unknown
  readonly streaming: unknown
}

/**
 * Read a code block's committed render props. Return undefined if React's code block cannot be found.
 * 读取代码块已提交的渲染属性。找不到对应的 React 代码块时返回 undefined。
 */
function readSource(block: Element): BlockSource | undefined {
  // React keeps the element's initial fiber even after committing its alternate.
  // React 提交另一个副本后，DOM 元素仍持有最初的 Fiber。
  const attached = reactValue(block, '__reactFiber$') as Fiber | undefined
  if (attached === undefined) return undefined
  // Read one committed path so the block, Markdown source and assistant state agree.
  // 沿同一条已提交路径读取代码块、Markdown 原文和助手消息状态，确保三者一致。
  const path = committedFiberPath(attached)
  if (path === undefined) return undefined
  let code: CodeProps | undefined
  let markdown: Record<string, unknown> | undefined
  for (const fiber of path) {
    const props = fiber.memoizedProps as Record<string, unknown> | null
    if (typeof props !== 'object' || props === null) continue
    if (code === undefined) {
      if (typeof props['code'] === 'string' && 'lang' in props) code = props as unknown as CodeProps
      continue
    }
    if (markdown === undefined) {
      if (typeof props['text'] === 'string' && typeof props['labels'] === 'object' && props['labels'] !== null) markdown = props
      continue
    }
    // AssistantMarkdown's root element always carries the key, valued only while streaming.
    if (fiber.tag === HOST_COMPONENT && Object.prototype.hasOwnProperty.call(props, 'data-streaming')) {
      return source(code, markdown, true)
    }
  }
  return code === undefined ? undefined : source(code, markdown, false)
}

function source(code: { code: string; lang: unknown; streaming: unknown }, markdown: Record<string, unknown> | undefined, assistant: boolean): BlockSource {
  return {
    code: code.code,
    language: typeof code.lang === 'string' ? code.lang : '',
    streaming: code.streaming === true || markdown?.['streaming'] === true,
    text: markdown?.['text'] as string | undefined,
    markdown: markdown === undefined
      ? undefined
      : { labels: markdown['labels'] as MarkdownLabels, fileMentions: markdown['fileMentions'], pathImages: markdown['pathImages'] },
    assistant,
  }
}

/** Live set of mounts, published to the overlay. */
export class AnswerScanner {
  private readonly mounts = new Map<Element, AnswerMount>()
  /** Blocks already judged not to be components, by the code and language they had then. */
  private readonly rejected = new WeakMap<Element, string>()
  private readonly listeners = new Set<() => void>()
  private snapshot: readonly AnswerMount[] = []
  private nextId = 1
  private timer: ReturnType<typeof setTimeout> | undefined

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getSnapshot = (): readonly AnswerMount[] => this.snapshot

  /** Watch the page; returns the disposer that also restores every hidden block. */
  start(): () => void {
    const stop = subscribeBodyInvalidations(() => { this.scan() })
    this.scan()
    return () => {
      stop()
      if (this.timer !== undefined) clearTimeout(this.timer)
      for (const [block, mount] of this.mounts) this.release(block, mount)
      this.mounts.clear()
      this.publish()
    }
  }

  /** Re-check every code block on the page. */
  scan(): void {
    let changed = false
    let pending = false
    for (const [block, mount] of this.mounts) {
      const current = block.isConnected ? readSource(block) : undefined
      if (current !== undefined && current.code === `${mount.body}\n` && current.language === mount.language && !current.streaming) continue
      this.release(block, mount)
      this.mounts.delete(block)
      changed = true
    }
    for (const block of document.querySelectorAll('.md-code-block')) {
      if (this.mounts.has(block)) continue
      if (block.closest('[data-streaming]') !== null) {
        pending = true
        continue
      }
      const found = readSource(block)
      if (found === undefined || !SUPPORTED_ANSWER_LANGUAGES.has(found.language)) continue
      if (found.streaming) {
        pending = true
        continue
      }
      const signature = `${found.language}\n${found.code}`
      if (this.rejected.get(block) === signature) continue
      const nested = block.closest(`[${ANCHOR_ATTRIBUTE}]`) !== null
      if ((!found.assistant && !nested) || found.text === undefined || found.markdown === undefined) {
        this.rejected.set(block, signature)
        continue
      }
      const body = found.code.replace(/\n$/u, '')
      const meta = findFenceInfo(found.text, found.language, found.code)?.meta ?? ''
      const component = parseAnswerComponent(found.language, meta, body)
      if (component === null) {
        this.rejected.set(block, signature)
        continue
      }
      const anchor = document.createElement('div')
      anchor.setAttribute(ANCHOR_ATTRIBUTE, found.language)
      block.after(anchor)
      block.setAttribute(HIDDEN_ATTRIBUTE, '')
      this.mounts.set(block, { id: this.nextId++, anchor, language: found.language, meta, body, component, markdown: found.markdown })
      changed = true
    }
    if (changed) this.publish()
    if (pending && this.timer === undefined) {
      this.timer = setTimeout(() => {
        this.timer = undefined
        this.scan()
      }, PENDING_RECHECK)
    }
  }

  private release(block: Element, mount: AnswerMount): void {
    block.removeAttribute(HIDDEN_ATTRIBUTE)
    mount.anchor.remove()
  }

  private publish(): void {
    this.snapshot = [...this.mounts.values()]
    for (const listener of [...this.listeners]) listener()
  }
}
