/** Write operations applied atomically across the scope files (`operations.rs`). */

import path from 'node:path'

import type { InjectionBudget } from '../settings.js'
import { MAX_FILE_BYTES, MAX_NODE_BODY_BYTES, MAX_NODE_LEVEL, MAX_OPERATIONS_PER_WRITE, MAX_TITLE_CHARS, byteLength } from './constants.js'
import { MemoryDocument, MemoryNode, isMetaValue, lines, nodeHeadingLevels, storedBody, titleRoundTrips, viewTitle, type NodeMeta, type NodeSource, type NodeView } from './document.js'
import { MemoryError } from './errors.js'
import { REGISTRY_FILE, isRecord, randomHex, type MemoryRegistry } from './registry.js'
import { BASE_SECTION_KEY, SCOPES, isScope, presetSections, type MemoryScope } from './scope.js'
import { baseUsage, nearBudget, overBudget, renderUsageLine, type BudgetUsage } from './snapshot.js'
import { boundProject, commitFiles, readOptional, type MarkdownMemoryStore, type PreparedFile, type ProjectContext } from './store.js'
import { nowUtcMinute } from './timestamp.js'
import { isCjkCharacter } from './tokens.js'

/** Where a created or moved node goes. */
export interface NodePlacement {
  /** Destination scope; a move without it stays in the node's scope. */
  readonly scope?: MemoryScope
  /** Parent node id; the node becomes its last child. */
  readonly parentId?: string
  /** Section key or H1 title; the node becomes its last child. */
  readonly section?: string
  /** Make the node a new H1 section of the scope. */
  readonly newSection: boolean
}

/** One requested change. */
export type WriteOperation =
  | ({ readonly action: 'create'; readonly title: string; readonly body: string } & NodePlacement)
  | { readonly action: 'replace'; readonly id: string; readonly expectedRevision: string; readonly body: string }
  | { readonly action: 'append'; readonly id: string; readonly expectedRevision: string; readonly text: string }
  | { readonly action: 'rename'; readonly id: string; readonly expectedRevision: string; readonly title: string }
  | ({ readonly action: 'move'; readonly id: string; readonly expectedRevision: string } & NodePlacement)
  | { readonly action: 'delete'; readonly id: string; readonly expectedRevision: string; readonly withChildren: boolean }

/** A node that may duplicate a written one. */
export interface DuplicateHint {
  readonly id: string
  readonly scope: MemoryScope
  readonly path: readonly string[]
}

/** Result of one applied operation. */
export interface WriteOperationReceipt {
  readonly action: WriteOperation['action']
  /** Node id after the operation; a node written for the first time receives a stable id. */
  readonly id: string
  readonly scope: MemoryScope
  readonly path: readonly string[]
  /** Revision after the operation; empty after a delete. */
  readonly revision: string
  readonly newSection: boolean
  readonly deletedChildren: number
  readonly duplicates: readonly DuplicateHint[]
}

/** Result of a whole write call. */
export interface WriteReceipt {
  readonly operations: readonly WriteOperationReceipt[]
  /** Usage of the injected full-text parts after the write. */
  readonly usage: readonly BudgetUsage[]
  /** Memory project created for the host project by this write. */
  readonly createdProject: string | undefined
}

/** The receipt as model-facing English text. */
export function renderWriteReceipt(receipt: WriteReceipt): string {
  const output = [`Applied ${receipt.operations.length} memory operation(s).`]
  if (receipt.createdProject !== undefined) output.push(`Created project memory \`${receipt.createdProject}\` for this project.`)
  for (const operation of receipt.operations) {
    let line = `- ${operation.action} ${operation.id} [${operation.scope}] ${operation.path.join(' › ')}`
    if (operation.revision !== '') line += ` (revision ${operation.revision})`
    if (operation.newSection) line += ' · new section'
    if (operation.deletedChildren > 0) line += ` · ${operation.deletedChildren} child node(s) deleted`
    output.push(line)
    if (operation.duplicates.length > 0) {
      const hints = operation.duplicates.map(hint => `${hint.id} [${hint.scope}] ${hint.path.join(' › ')}`).join('; ')
      output.push(`  possible duplicates (merge if they cover the same fact): ${hints}`)
    }
  }
  for (const usage of receipt.usage) {
    output.push(renderUsageLine(usage))
    if (overBudget(usage)) output.push('  Base is over budget: move less essential nodes from the base section to a catalog section.')
    else if (nearBudget(usage)) output.push('  Base is nearly full: keep only rules that would cause mistakes if unknown.')
  }
  return output.join('\n')
}

const OPERATION_FIELDS: Record<WriteOperation['action'], readonly string[]> = {
  create: ['action', 'title', 'body', 'scope', 'parentId', 'section', 'newSection'],
  replace: ['action', 'id', 'expectedRevision', 'body'],
  append: ['action', 'id', 'expectedRevision', 'text'],
  rename: ['action', 'id', 'expectedRevision', 'title'],
  move: ['action', 'id', 'expectedRevision', 'scope', 'parentId', 'section', 'newSection'],
  delete: ['action', 'id', 'expectedRevision', 'withChildren'],
}

/**
 * Parse one operation the way VulcanCode's serde enum does: tagged by `action`, camelCase fields,
 * unknown fields refused, optional fields may be absent or null. Messages describe the problem
 * without the `Invalid arguments:` prefix the tool layer adds.
 */
export function parseWriteOperation(value: unknown): WriteOperation {
  if (!isRecord(value)) throw MemoryError.invalid('each operation must be an object')
  const action = value['action']
  if (typeof action !== 'string' || !Object.hasOwn(OPERATION_FIELDS, action)) {
    throw MemoryError.invalid(`unknown variant ${JSON.stringify(action)}, expected one of create, replace, append, rename, move, delete`)
  }
  const kind = action as WriteOperation['action']
  const unknown = Object.keys(value).find(key => !OPERATION_FIELDS[kind].includes(key))
  if (unknown !== undefined) throw MemoryError.invalid(`unknown field \`${unknown}\` for action \`${kind}\``)
  const required = (field: string): string => {
    const text = value[field]
    if (typeof text !== 'string') throw MemoryError.invalid(`\`${kind}\` needs the string field \`${field}\``)
    return text
  }
  const optional = (field: string): string | undefined => {
    const text = value[field]
    if (text === undefined || text === null) return undefined
    if (typeof text !== 'string') throw MemoryError.invalid(`\`${field}\` must be a string`)
    return text
  }
  const flag = (field: string): boolean => {
    const bit = value[field]
    if (bit === undefined) return false
    if (typeof bit !== 'boolean') throw MemoryError.invalid(`\`${field}\` must be a boolean`)
    return bit
  }
  const placement = (): NodePlacement => {
    const scope = value['scope']
    if (scope !== undefined && scope !== null && !isScope(scope)) throw MemoryError.invalid('`scope` must be user, space or project')
    const parentId = optional('parentId')
    const section = optional('section')
    return {
      ...isScope(scope) ? { scope } : {},
      ...parentId === undefined ? {} : { parentId },
      ...section === undefined ? {} : { section },
      newSection: flag('newSection'),
    }
  }
  switch (kind) {
    case 'create': return { action: kind, title: required('title'), body: optional('body') ?? '', ...placement() }
    case 'replace': return { action: kind, id: required('id'), expectedRevision: required('expectedRevision'), body: required('body') }
    case 'append': return { action: kind, id: required('id'), expectedRevision: required('expectedRevision'), text: required('text') }
    case 'rename': return { action: kind, id: required('id'), expectedRevision: required('expectedRevision'), title: required('title') }
    case 'move': return { action: kind, id: required('id'), expectedRevision: required('expectedRevision'), ...placement() }
    case 'delete': return { action: kind, id: required('id'), expectedRevision: required('expectedRevision'), withChildren: flag('withChildren') }
  }
}

/** One scope file loaded for a write. */
interface LoadedScope {
  readonly path: string
  /** Exact text read, or `undefined` when missing. */
  readonly original: string | undefined
  readonly document: MemoryDocument
  changed: boolean
}

/** Who writes and in which conversation; recorded in node metadata. */
export interface WriteAuthor {
  /** Conversation id; dropped when it cannot be stored in a metadata line. */
  readonly session: string | undefined
  readonly source: NodeSource
}

/** Apply operations in order, all or nothing; a failed commit restores originals or reports an incomplete rollback. */
export function writeMemory(store: MarkdownMemoryStore, context: ProjectContext, author: WriteAuthor, budget: InjectionBudget, operations: readonly WriteOperation[]): WriteReceipt {
  if (operations.length === 0 || operations.length > MAX_OPERATIONS_PER_WRITE) {
    throw MemoryError.invalid(`Provide 1 to ${MAX_OPERATIONS_PER_WRITE} operations.`)
  }
  const session = new WriteSession(store, context, author)
  const receipts = operations.map((operation, index) => {
    try {
      return session.apply(operation)
    } catch (error) {
      throw error instanceof MemoryError ? MemoryError.operation(index + 1, error) : error
    }
  })
  return session.finish(receipts, budget)
}

/** Mutable state of one write call. */
class WriteSession {
  private readonly registry: MemoryRegistry
  private projectId: string | undefined
  private createdProject: string | undefined
  private readonly scopes = new Map<MemoryScope, LoadedScope>()
  private readonly session: string | undefined
  /** Timestamp shared by every change of this call. */
  private readonly now = nowUtcMinute()

  constructor(private readonly store: MarkdownMemoryStore, private readonly context: ProjectContext, private readonly author: WriteAuthor) {
    this.registry = store.registry()
    this.projectId = boundProject(context, this.registry)?.id
    this.session = author.session !== undefined && isMetaValue(author.session) ? author.session : undefined
  }

  /** Load a scope on first use, seeding preset sections into a missing or blank file. */
  private scope(scope: MemoryScope): LoadedScope {
    const loaded = this.scopes.get(scope)
    if (loaded !== undefined) return loaded
    const file = this.store.scopePath(scope, scope === 'project' ? this.ensureProject() : undefined)
    const original = readOptional(file)
    const blank = original === undefined || original.trim() === ''
    const created: LoadedScope = {
      path: file,
      original,
      document: blank ? presetDocument(scope, this.now) : MemoryDocument.parse(original),
      changed: blank,
    }
    this.scopes.set(scope, created)
    return created
  }

  /** The bound memory project, creating and binding one for the host project if needed. */
  private ensureProject(): string {
    if (this.projectId !== undefined) {
      // Users may still edit a project whose memory is off; only AI writes are refused.
      if (this.author.source === 'ai' && this.registry.project(this.projectId)?.memoryEnabled === false) {
        throw new MemoryError('project_unavailable', 'Memory is turned off for this project.')
      }
      return this.projectId
    }
    const { hostProjectId, rootPath } = this.context
    if (hostProjectId === undefined || rootPath === undefined) {
      throw new MemoryError('project_unavailable', 'This conversation has no project, so project memory is unavailable.')
    }
    const id = this.registry.createForHost(hostProjectId, rootPath, undefined, this.now)
    this.projectId = id
    this.createdProject = id
    return id
  }

  /** Views of every scope that is loaded or can be loaded without creating a project. */
  private allViews(): NodeView[] {
    const scopes: MemoryScope[] = this.projectId === undefined ? ['user', 'space'] : ['user', 'space', 'project']
    return scopes.flatMap(scope => this.scope(scope).document.views(scope))
  }

  /** Find a node by id across scopes and check its revision. */
  private locate(id: string, expectedRevision: string): NodeView {
    const view = this.allViews().find(candidate => candidate.id === id)
    if (view === undefined) throw MemoryError.notFound(id)
    if (view.revision !== expectedRevision.trim()) throw MemoryError.revisionMismatch(id, expectedRevision, view.revision)
    return view
  }

  apply(operation: WriteOperation): WriteOperationReceipt {
    switch (operation.action) {
      case 'create':
        return this.create(operation.title, operation.body, operation)
      case 'replace': {
        const view = this.locate(operation.id, operation.expectedRevision)
        validateBody(operation.body)
        return this.updateNode(view, 'replace', (node, eol) => node.setBody(storedBody(operation.body, eol)))
      }
      case 'append': {
        const view = this.locate(operation.id, operation.expectedRevision)
        const text = operation.text.trim()
        if (text === '') throw MemoryError.invalid('Append text must not be empty.')
        const combined = view.body === '' ? text : `${view.body}\n\n${text}`
        validateBody(combined)
        return this.updateNode(view, 'append', (node, eol) => node.setBody(storedBody(combined, eol)))
      }
      case 'rename': {
        const view = this.locate(operation.id, operation.expectedRevision)
        const title = validateTitle(operation.title, view.level)
        return this.updateNode(view, 'rename', node => node.setTitle(title))
      }
      case 'move':
        return this.moveNode(operation.id, operation.expectedRevision, operation)
      case 'delete':
        return this.delete(operation.id, operation.expectedRevision, operation.withChildren)
    }
  }

  private create(title: string, body: string, placement: NodePlacement): WriteOperationReceipt {
    const scope = placement.scope
    if (scope === undefined) throw MemoryError.invalid('create requires `scope`.')
    validateBody(body)
    const { parent, level, sectionKey } = this.resolvePlacement(scope, placement, undefined)
    const validTitle = validateTitle(title, level)
    const duplicates = this.duplicates(scope, validTitle, body, undefined)
    const id = this.freshId()
    const meta: NodeMeta = {
      id,
      ...sectionKey === undefined ? {} : { section: sectionKey },
      created: this.now,
      updated: this.now,
      ...this.session === undefined ? {} : { session: this.session },
      source: this.author.source,
    }
    const loaded = this.scope(scope)
    loaded.document.append(parent, new MemoryNode(level, validTitle, meta, storedBody(body, loaded.document.eol)))
    loaded.changed = true
    const view = this.viewById(scope, id)
    return { action: 'create', id, scope, path: view.path, revision: view.revision, newSection: sectionKey !== undefined, deletedChildren: 0, duplicates }
  }

  private moveNode(id: string, expectedRevision: string, placement: NodePlacement): WriteOperationReceipt {
    const view = this.locate(id, expectedRevision)
    guardBaseSection(view, 'moved')
    const targetScope = placement.scope ?? view.scope
    const source = this.scope(view.scope)
    const node = source.document.remove(view.locator)
    if (node === undefined) throw MemoryError.notFound(id)
    source.changed = true
    const { parent, level, sectionKey } = this.resolvePlacement(targetScope, placement, id)
    const deepest = node.relevel(level)
    if (deepest !== undefined) {
      throw MemoryError.invalid(`Moving there would put nodes at heading level ${deepest}; memory nodes stop at H${MAX_NODE_LEVEL}.`)
    }
    const touched = this.touchedMeta(node.meta)
    const { section: _previous, ...rest } = touched
    const meta: NodeMeta = sectionKey === undefined ? rest : { ...rest, section: sectionKey }
    node.setMeta(meta)
    const target = this.scope(targetScope)
    target.document.append(parent, node)
    target.changed = true
    const moved = this.viewById(targetScope, meta.id)
    return { action: 'move', id: meta.id, scope: targetScope, path: moved.path, revision: moved.revision, newSection: sectionKey !== undefined, deletedChildren: 0, duplicates: [] }
  }

  private delete(id: string, expectedRevision: string, withChildren: boolean): WriteOperationReceipt {
    const view = this.locate(id, expectedRevision)
    guardBaseSection(view, 'deleted')
    if (view.descendants > 0 && !withChildren) {
      throw MemoryError.invalid(`Node \`${id}\` has ${view.descendants} child node(s); set withChildren to delete them too, or move them first.`)
    }
    const loaded = this.scope(view.scope)
    if (loaded.document.remove(view.locator) === undefined) throw MemoryError.notFound(id)
    loaded.changed = true
    return { action: 'delete', id: view.id, scope: view.scope, path: view.path, revision: '', newSection: false, deletedChildren: view.descendants, duplicates: [] }
  }

  /** Apply an in-place change and refresh the node's metadata. */
  private updateNode(view: NodeView, action: 'replace' | 'append' | 'rename', change: (node: MemoryNode, eol: string) => void): WriteOperationReceipt {
    const meta = this.touchedMeta(view.meta)
    const loaded = this.scope(view.scope)
    const node = loaded.document.node(view.locator)
    if (node === undefined) throw MemoryError.notFound(view.id)
    change(node, loaded.document.eol)
    node.setMeta(meta)
    loaded.changed = true
    const updated = this.viewById(view.scope, meta.id)
    const duplicates = action === 'rename' ? this.duplicates(view.scope, viewTitle(updated), updated.body, meta.id) : []
    return { action, id: meta.id, scope: view.scope, path: updated.path, revision: updated.revision, newSection: false, deletedChildren: 0, duplicates }
  }

  /** Metadata for a written node: existing identity with a new update time, or a new identity. */
  private touchedMeta(existing: NodeMeta | undefined): NodeMeta {
    if (existing !== undefined) {
      const session = this.session ?? existing.session
      const { session: _previous, ...rest } = existing
      return { ...rest, updated: this.now, ...session === undefined ? {} : { session }, source: this.author.source }
    }
    return { id: this.freshId(), created: this.now, updated: this.now, ...this.session === undefined ? {} : { session: this.session }, source: this.author.source }
  }

  /** Resolve a placement to its parent locator, heading level and new section key. */
  private resolvePlacement(scope: MemoryScope, placement: NodePlacement, movingId: string | undefined): { parent: readonly number[] | undefined; level: number; sectionKey: string | undefined } {
    const choices = [placement.parentId !== undefined, placement.section !== undefined, placement.newSection].filter(Boolean).length
    if (choices !== 1) throw MemoryError.invalid('Give exactly one of `parentId`, `section` or `newSection`.')
    const views = this.scope(scope).document.views(scope)
    if (placement.parentId !== undefined) {
      const parentId = placement.parentId
      const parent = views.find(view => view.id === parentId)
      if (parent === undefined) {
        throw MemoryError.invalid(movingId !== undefined
          ? `Parent \`${parentId}\` is not in the ${scope} scope, or it is inside the node being moved.`
          : `Parent \`${parentId}\` is not in the ${scope} scope.`)
      }
      if (parent.level >= MAX_NODE_LEVEL) {
        throw MemoryError.invalid(`Parent \`${parentId}\` is already H${MAX_NODE_LEVEL}; add the content to its body or choose a shallower parent.`)
      }
      return { parent: parent.locator, level: parent.level + 1, sectionKey: undefined }
    }
    if (placement.section !== undefined) {
      const wanted = placement.section.trim()
      const parent = views.find(view => view.level === 1 && view.section === wanted)
        ?? views.find(view => view.locator.length === 1 && view.level === 1 && view.path[0] !== undefined && asciiLower(view.path[0]) === asciiLower(wanted))
      if (parent === undefined) {
        const existing = views.filter(view => view.locator.length === 1 && view.level === 1).map(view => view.section ?? view.path[0]).join(', ')
        throw MemoryError.invalid(`Section \`${wanted}\` does not exist in the ${scope} scope (existing: ${existing}). Use one of them, or set newSection to declare a new one.`)
      }
      return { parent: parent.locator, level: 2, sectionKey: undefined }
    }
    const taken = new Set(views.flatMap(view => view.section === undefined ? [] : [view.section]))
    for (;;) {
      const candidate = `s-${randomHex(6)}`
      if (!taken.has(candidate)) return { parent: undefined, level: 1, sectionKey: candidate }
    }
  }

  /** A node id unused in every loaded scope. */
  private freshId(): string {
    const used = new Set(this.allViews().map(view => view.id))
    for (;;) {
      const candidate = `m-${randomHex(8)}`
      if (!used.has(candidate)) return candidate
    }
  }

  private viewById(scope: MemoryScope, id: string): NodeView {
    const view = this.scope(scope).document.views(scope).find(candidate => candidate.id === id)
    if (view === undefined) throw MemoryError.notFound(id)
    return view
  }

  /** Similar nodes in the same scope, and in the space scope for project writes. */
  private duplicates(scope: MemoryScope, title: string, body: string, exclude: string | undefined): DuplicateHint[] {
    const scored: [number, NodeView][] = []
    for (const candidateScope of scope === 'project' ? ['project', 'space'] as const : [scope]) {
      for (const view of this.scope(candidateScope).document.views(candidateScope)) {
        if (view.id === exclude || view.level === 1) continue
        const score = similarity(title, body, viewTitle(view), view.body)
        if (score >= DUPLICATE_THRESHOLD) scored.push([score, view])
      }
    }
    scored.sort((left, right) => right[0] - left[0])
    return scored.slice(0, 3).map(([, view]) => ({ id: view.id, scope: view.scope, path: view.path }))
  }

  /** Validate file sizes and commit every changed file together with the registry. */
  finish(operations: readonly WriteOperationReceipt[], budget: InjectionBudget): WriteReceipt {
    const files: PreparedFile[] = []
    for (const scope of SCOPES) {
      const loaded = this.scopes.get(scope)
      if (loaded === undefined || !loaded.changed) continue
      const text = loaded.document.render()
      const bytes = byteLength(text)
      if (bytes > MAX_FILE_BYTES) {
        throw MemoryError.invalid(`\`${loaded.path}\` would grow to ${bytes} bytes, above the ${MAX_FILE_BYTES}-byte limit; merge or delete outdated nodes first.`)
      }
      files.push({ path: loaded.path, original: loaded.original, text })
    }
    if (this.createdProject !== undefined) {
      const file = path.join(this.store.markdownDirectory, REGISTRY_FILE)
      files.push({ path: file, original: readOptional(file), text: `${this.registry.toJson()}\n` })
    }
    commitFiles(files)
    const touched = new Set(operations.map(operation => operation.scope))
    const usage = SCOPES.filter(scope => touched.has(scope)).map(scope => baseUsage(scope, this.scope(scope).document, budget))
    return { operations, usage, createdProject: this.createdProject }
  }
}

/** Similarity at or above which a node is reported as a possible duplicate. */
const DUPLICATE_THRESHOLD = 0.6

/** Score two nodes by title character bigrams and body word overlap. */
export function similarity(title: string, body: string, otherTitle: string, otherBody: string): number {
  const titles = jaccard(titleBigrams(title), titleBigrams(otherTitle))
  const left = bodyTerms(body)
  const right = bodyTerms(otherBody)
  const bodies = left.size >= 8 && right.size >= 8 ? jaccard(left, right) * 0.8 : 0
  return Math.max(titles, bodies)
}

/** Lowercase character bigrams of a title, ignoring spaces and punctuation (Rust `char::is_alphanumeric`). */
function titleBigrams(title: string): Set<string> {
  const characters = [...title].filter(character => /[\p{Alphabetic}\p{N}]/u.test(character)).flatMap(character => [...character.toLowerCase()])
  if (characters.length === 1) return new Set(characters)
  const pairs = new Set<string>()
  for (let index = 0; index + 1 < characters.length; index += 1) pairs.add(`${characters[index]}${characters[index + 1]}`)
  return pairs
}

/** Body terms: lowercase ASCII words of three or more letters and CJK bigrams. */
function bodyTerms(body: string): Set<string> {
  const terms = new Set<string>()
  for (const word of body.split(/[^A-Za-z0-9]/)) if (word.length >= 3) terms.add(word.toLowerCase())
  const cjk = [...body].filter(character => isCjkCharacter(character.codePointAt(0) ?? 0))
  for (let index = 0; index + 1 < cjk.length; index += 1) terms.add(`${cjk[index]}${cjk[index + 1]}`)
  return terms
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let shared = 0
  for (const term of left) if (right.has(term)) shared += 1
  const union = left.size + right.size - shared
  return union === 0 ? 0 : shared / union
}

/** Rust `eq_ignore_ascii_case` folds only ASCII letters. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, letter => letter.toLowerCase())
}

/** Refuse to move or delete the base section. */
function guardBaseSection(view: NodeView, verb: string): void {
  if (view.level === 1 && view.locator.length === 1 && view.meta?.section === BASE_SECTION_KEY) {
    throw MemoryError.invalid(`The base section cannot be ${verb}; change the nodes inside it instead.`)
  }
}

/** Validate a title for a heading level and return it trimmed. */
function validateTitle(title: string, level: number): string {
  const trimmed = title.trim()
  if (trimmed === '' || [...trimmed].length > MAX_TITLE_CHARS) throw MemoryError.invalid(`A title must have 1 to ${MAX_TITLE_CHARS} characters.`)
  if (trimmed.startsWith('#') || !titleRoundTrips(level, trimmed)) {
    throw MemoryError.invalid(`Title \`${trimmed}\` must be a single line of plain heading text (no leading or trailing \`#\`).`)
  }
  return trimmed
}

/** Validate a body: size, no node-forming headings and no metadata comments. */
function validateBody(body: string): void {
  if (byteLength(body) > MAX_NODE_BODY_BYTES) throw MemoryError.invalid(`A node body can hold at most ${MAX_NODE_BODY_BYTES} bytes; split it into child nodes.`)
  const [level] = nodeHeadingLevels(body)
  if (level !== undefined) {
    throw MemoryError.invalid(`The body contains an H${level} heading, which would create a separate node; create a child node instead, or use H5/H6 inside the body.`)
  }
  if (lines(body).some(line => line.trimStart().startsWith('<!-- mem'))) {
    throw MemoryError.invalid('The body must not contain `<!-- mem` metadata comments; the host maintains them.')
  }
}

/** A document holding the scope's preset sections. */
function presetDocument(scope: MemoryScope, now: string): MemoryDocument {
  const document = MemoryDocument.empty()
  for (const [key, title] of presetSections(scope)) {
    document.append(undefined, new MemoryNode(1, title, { id: `m-${randomHex(8)}`, section: key, created: now, updated: now, source: 'user' }, '\n'))
  }
  return document
}
