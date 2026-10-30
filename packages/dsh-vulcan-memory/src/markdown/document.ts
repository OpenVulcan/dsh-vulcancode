/**
 * One memory file parsed into heading nodes (`document.rs`). Parsing never fails and rendering
 * reproduces the source bytes exactly; only nodes that were written regenerate their heading or
 * metadata line. Headings are found with a CommonMark parser, so `#` lines inside fences, quotes
 * and lists stay body text.
 */

import { createHash } from 'node:crypto'

import { fromMarkdown } from 'mdast-util-from-markdown'

import { MAX_NODE_LEVEL } from './constants.js'
import type { MemoryScope } from './scope.js'

export type NodeSource = 'ai' | 'user'

/** Parsed `<!-- mem ... -->` metadata line. */
export interface NodeMeta {
  readonly id: string
  readonly section?: string
  readonly created: string
  readonly updated: string
  readonly session?: string
  readonly source: NodeSource
}

const META_PREFIX = '<!-- mem '
const META_VALUE = /^[A-Za-z0-9\-_.:]+$/

/** Whether a value can be stored in a metadata line and read back. */
export function isMetaValue(value: string): boolean {
  return META_VALUE.test(value)
}

/** Parse one metadata line; malformed lines are ordinary body text. */
export function parseMetaLine(line: string): NodeMeta | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith(META_PREFIX) || !trimmed.endsWith('-->')) return undefined
  const inner = trimmed.slice(META_PREFIX.length, trimmed.length - 3).trim()
  const fields: Partial<Record<'id' | 'section' | 'created' | 'updated' | 'session', string>> = {}
  let source: NodeSource | undefined
  for (const pair of inner.split(/\s+/).filter(part => part !== '')) {
    const equals = pair.indexOf('=')
    if (equals < 0) return undefined
    const key = pair.slice(0, equals)
    const value = pair.slice(equals + 1)
    if (!META_VALUE.test(value)) return undefined
    switch (key) {
      case 'id': case 'section': case 'created': case 'updated': case 'session':
        fields[key] = value
        break
      case 'source':
        if (value !== 'ai' && value !== 'user') return undefined
        source = value
        break
    }
  }
  if (fields.id === undefined || fields.created === undefined || fields.updated === undefined || source === undefined) return undefined
  return {
    id: fields.id,
    ...fields.section === undefined ? {} : { section: fields.section },
    created: fields.created,
    updated: fields.updated,
    ...fields.session === undefined ? {} : { session: fields.session },
    source,
  }
}

/** Render a metadata comment without a line terminator. */
export function renderMeta(meta: NodeMeta): string {
  let line = `${META_PREFIX}id=${meta.id}`
  if (meta.section !== undefined) line += ` section=${meta.section}`
  line += ` created=${meta.created} updated=${meta.updated}`
  if (meta.session !== undefined) line += ` session=${meta.session}`
  return `${line} source=${meta.source} -->`
}

/** One heading node with its own body and child nodes. */
export class MemoryNode {
  /** Original heading bytes including the terminator; `undefined` regenerates it. */
  private headingRaw: string | undefined
  /** Original metadata line including the terminator; `undefined` regenerates it. */
  private metaRaw: string | undefined
  children: MemoryNode[] = []

  constructor(
    public level: number,
    public title: string,
    public meta: NodeMeta | undefined,
    /** Own body bytes up to the next node heading. */
    private body: string,
    raw?: { heading: string; meta: string | undefined },
  ) {
    this.headingRaw = raw?.heading
    this.metaRaw = raw?.meta
  }

  /** Copy without children for another document: lines regenerate at `level`, the body uses `eol`. */
  detached(level: number, eol: string): MemoryNode {
    return new MemoryNode(level, this.title, this.meta, storedBody(this.bodyText(), eol))
  }

  rawBody(): string {
    return this.body
  }

  /** The own body with normalized line endings and no surrounding blank lines. */
  bodyText(): string {
    return normalizeNewlines(this.body).replace(/^\n+|\n+$/g, '').trimEnd()
  }

  setBody(body: string): void {
    this.body = body
  }

  setTitle(title: string): void {
    this.title = title
    this.headingRaw = undefined
  }

  setMeta(meta: NodeMeta): void {
    this.meta = meta
    this.metaRaw = undefined
  }

  /** Shift the subtree to a new root level; returns the deepest level reached when it does not fit. */
  relevel(level: number): number | undefined {
    const deepest = level + this.subtreeDepth()
    if (level === 0 || deepest > MAX_NODE_LEVEL) return deepest
    this.shiftLevels(level - this.level)
    return undefined
  }

  private subtreeDepth(): number {
    return Math.max(0, ...this.children.map(child => Math.max(0, child.level - this.level) + child.subtreeDepth()))
  }

  private shiftLevels(delta: number): void {
    if (delta !== 0) {
      this.level += delta
      this.headingRaw = undefined
    }
    for (const child of this.children) child.shiftLevels(delta)
  }

  /** Revision token of the node's own title and body. */
  revision(): string {
    return createHash('sha256').update(this.title.trim()).update(Buffer.from([0])).update(this.bodyText()).digest('hex').slice(0, 8)
  }

  descendantCount(): number {
    return this.children.reduce((count, child) => count + 1 + child.descendantCount(), 0)
  }

  /** Append this subtree's text, reusing original bytes wherever they are still valid. */
  render(eol: string, output: string[]): void {
    ensureLineStart(output, eol)
    output.push(this.headingRaw ?? `${'#'.repeat(this.level)} ${this.title}${eol}`)
    if (this.meta !== undefined) {
      ensureLineStart(output, eol)
      output.push(this.metaRaw ?? `${renderMeta(this.meta)}${eol}`)
    }
    if (this.body !== '') {
      ensureLineStart(output, eol)
      output.push(this.body)
    }
    for (const child of this.children) child.render(eol, output)
  }
}

/** A flattened, read-only view of one node used by search, outline and writes. */
export interface NodeView {
  /** Metadata id, or an `h-` id derived from scope, title path and occurrence. */
  readonly id: string
  readonly scope: MemoryScope
  readonly level: number
  /** Titles from the top-level node down to this one. */
  readonly path: readonly string[]
  /** Child indexes from the document root. */
  readonly locator: readonly number[]
  /** Section key of the top-level H1 this node belongs to. */
  readonly section: string | undefined
  readonly revision: string
  readonly meta: NodeMeta | undefined
  /** Normalized own body. */
  readonly body: string
  /** Titles of the direct children. */
  readonly children: readonly string[]
  readonly descendants: number
}

/** The last title of a view's path. */
export function viewTitle(view: NodeView): string {
  return view.path[view.path.length - 1] ?? ''
}

/** One parsed memory file. */
export class MemoryDocument {
  private constructor(
    /** Line terminator for generated lines, taken from the source. */
    readonly eol: '\n' | '\r\n',
    /** Bytes before the first node heading. */
    private readonly preamble: string,
    readonly roots: MemoryNode[],
  ) {}

  static empty(): MemoryDocument {
    return new MemoryDocument('\n', '', [])
  }

  static parse(text: string): MemoryDocument {
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const headings = scanHeadings(text)
    const first = headings[0]
    if (first === undefined) return new MemoryDocument(eol, text, [])
    const flat = headings.map((heading, index) => {
      const ownEnd = headings[index + 1]?.start ?? text.length
      const headingRaw = text.slice(heading.start, heading.after)
      let bodyStart = heading.after
      let meta: NodeMeta | undefined
      let metaRaw: string | undefined
      if (bodyStart < ownEnd) {
        const newline = text.slice(bodyStart, ownEnd).indexOf('\n')
        const lineEnd = newline < 0 ? ownEnd : bodyStart + newline + 1
        meta = parseMetaLine(text.slice(bodyStart, lineEnd))
        if (meta !== undefined) {
          metaRaw = text.slice(bodyStart, lineEnd)
          bodyStart = lineEnd
        }
      }
      return new MemoryNode(heading.level, headingTitle(headingRaw, heading.level), meta, text.slice(bodyStart, ownEnd), { heading: headingRaw, meta: metaRaw })
    })
    return new MemoryDocument(eol, text.slice(0, first.start), buildTree(flat))
  }

  render(): string {
    const output = [this.preamble]
    for (const node of this.roots) node.render(this.eol, output)
    return output.join('')
  }

  /** Views of every node in document order. */
  views(scope: MemoryScope): NodeView[] {
    const views: NodeView[] = []
    const occurrences = new Map<string, number>()
    this.roots.forEach((node, index) => {
      const section = node.level === 1 ? node.meta?.section : undefined
      collectViews(node, scope, [], [index], section, occurrences, views)
    })
    return views
  }

  node(locator: readonly number[]): MemoryNode | undefined {
    const [first, ...rest] = locator
    if (first === undefined) return undefined
    let node = this.roots[first]
    for (const index of rest) node = node?.children[index]
    return node
  }

  /** Remove and return the subtree at a locator. */
  remove(locator: readonly number[]): MemoryNode | undefined {
    const last = locator[locator.length - 1]
    if (last === undefined) return undefined
    const parent = locator.slice(0, -1)
    const siblings = parent.length === 0 ? this.roots : this.node(parent)?.children
    if (siblings === undefined || last >= siblings.length) return undefined
    return siblings.splice(last, 1)[0]
  }

  /** Append a subtree as the last child of a parent, or as the last top-level node. */
  append(parent: readonly number[] | undefined, node: MemoryNode): boolean {
    if (parent === undefined) {
      this.roots.push(node)
      return true
    }
    const target = this.node(parent)
    if (target === undefined) return false
    target.children.push(node)
    return true
  }
}

/** Convert written text into stored body bytes: the file's terminators and one trailing blank line. */
export function storedBody(text: string, eol: string): string {
  const trimmed = normalizeNewlines(text).replace(/^\n+|\n+$/g, '').trimEnd()
  if (trimmed === '') return eol
  return `${trimmed.replaceAll('\n', eol)}${eol}${eol}`
}

/** Levels of node-forming headings in text written as a body. */
export function nodeHeadingLevels(text: string): number[] {
  return scanHeadings(text).map(heading => heading.level)
}

/** Whether text renders as exactly one ATX heading with the given title. */
export function titleRoundTrips(level: number, title: string): boolean {
  const line = `${'#'.repeat(level)} ${title}\n`
  const headings = scanHeadings(line)
  const [only] = headings
  return headings.length === 1 && only !== undefined && only.level === level
    && headingTitle(line.slice(only.start, only.after), level) === title
}

function normalizeNewlines(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

interface ScannedHeading {
  readonly start: number
  /** Offset just after the heading's last line terminator. */
  readonly after: number
  readonly level: number
}

/** Top-level H1–H4 headings; a heading inside a quote, list or fence is not top level. */
function scanHeadings(text: string): ScannedHeading[] {
  const headings: ScannedHeading[] = []
  for (const child of fromMarkdown(text).children) {
    if (child.type !== 'heading' || child.depth > MAX_NODE_LEVEL) continue
    const start = child.position?.start.offset
    const end = child.position?.end.offset
    if (start === undefined || end === undefined) continue
    const last = Math.max(end - 1, start)
    const newline = text.indexOf('\n', last)
    headings.push({ start, after: newline < 0 ? text.length : newline + 1, level: child.depth })
  }
  return headings
}

/** Rust `str::lines`: split on `\n`, drop one trailing empty line, strip a `\r` ending each line. */
export function lines(text: string): string[] {
  const parts = text.split('\n')
  if (parts[parts.length - 1] === '') parts.pop()
  return parts.map(line => line.endsWith('\r') ? line.slice(0, -1) : line)
}

/** The raw title text of an ATX or setext heading's source. */
function headingTitle(raw: string, level: number): string {
  const all = lines(raw)
  const first = all[0] ?? ''
  const stripped = first.replace(/^ +/, '')
  const marker = '#'.repeat(level)
  if (first.length - stripped.length <= 3 && stripped.startsWith(marker)) {
    const rest = stripped.slice(marker.length)
    if (rest === '' || rest.startsWith(' ') || rest.startsWith('\t')) {
      const content = rest.trim()
      const withoutClosing = content.replace(/#+$/, '')
      if (withoutClosing === '') return ''
      return /[ \t]$/.test(withoutClosing) ? withoutClosing.trimEnd() : content
    }
  }
  return all.slice(0, Math.max(0, all.length - 1)).map(line => line.trim()).join(' ')
}

/** Nest a flat heading list into a tree by level. */
function buildTree(flat: MemoryNode[]): MemoryNode[] {
  const roots: MemoryNode[] = []
  const stack: MemoryNode[] = []
  const attach = (node: MemoryNode) => {
    const parent = stack[stack.length - 1]
    if (parent === undefined) roots.push(node)
    else parent.children.push(node)
  }
  for (const node of flat) {
    while ((stack[stack.length - 1]?.level ?? 0) >= node.level) attach(stack.pop() as MemoryNode)
    stack.push(node)
  }
  while (stack.length > 0) attach(stack.pop() as MemoryNode)
  return roots
}

function ensureLineStart(output: string[], eol: string): void {
  const last = output.findLast(part => part !== '')
  if (last !== undefined && !last.endsWith('\n')) output.push(eol)
}

function collectViews(
  node: MemoryNode,
  scope: MemoryScope,
  path: string[],
  locator: number[],
  section: string | undefined,
  occurrences: Map<string, number>,
  views: NodeView[],
): void {
  path.push(node.title)
  let id = node.meta?.id
  if (id === undefined) {
    const key = JSON.stringify(path)
    const occurrence = (occurrences.get(key) ?? 0) + 1
    occurrences.set(key, occurrence)
    id = derivedNodeId(scope, path, occurrence)
  }
  views.push({
    id,
    scope,
    level: node.level,
    path: [...path],
    locator: [...locator],
    section,
    revision: node.revision(),
    meta: node.meta,
    body: node.bodyText(),
    children: node.children.map(child => child.title),
    descendants: node.descendantCount(),
  })
  node.children.forEach((child, index) => {
    locator.push(index)
    collectViews(child, scope, path, locator, section, occurrences, views)
    locator.pop()
  })
  path.pop()
}

/** Stable id of a node without metadata, from its scope, title path and occurrence. */
function derivedNodeId(scope: MemoryScope, path: readonly string[], occurrence: number): string {
  const hash = createHash('sha256').update(scope)
  const separator = Buffer.from([0x1f])
  for (const title of path) hash.update(separator).update(title)
  hash.update(separator).update(String(occurrence))
  return `h-${hash.digest('hex').slice(0, 10)}`
}
