/** Node search and outline (`search.rs`), modelled on `rg` → owner and `markdown-menu`. */

import { DEFAULT_SEARCH_LIMIT, MAX_NODE_LEVEL, MAX_SEARCH_LIMIT, MAX_SEARCH_PATTERNS, NODE_PAGE_BYTES, byteLength } from './constants.js'
import { lines as bodyLines, viewTitle, type NodeView } from './document.js'
import { MemoryError } from './errors.js'
import { compare } from './registry.js'
import { SCOPES, scopePriority, type MemoryScope } from './scope.js'
import { scopeDocument, type ScopeDocuments } from './store.js'

/** Arguments of `memory_search`. */
export interface SearchRequest {
  /** Patterns combined with OR. */
  readonly patterns?: readonly string[]
  /** Treat patterns as literal text. */
  readonly fixedStrings?: boolean
  /** Case-insensitive matching; defaults to true. */
  readonly ignoreCase?: boolean
  /** Scopes to search; empty means every available scope. */
  readonly scopes?: readonly MemoryScope[]
  /** Section key or H1 title filter. */
  readonly section?: string
  /** Title path prefix filter, segments separated by `/` or `›`. */
  readonly pathPrefix?: string
  /** Exact node ids to read instead of patterns. */
  readonly ids?: readonly string[]
  /** Nodes per page. */
  readonly limit?: number
  /** Continuation cursor from a previous result. */
  readonly cursor?: string
}

/** Arguments of `memory_outline`. */
export interface OutlineRequest {
  readonly scopes?: readonly MemoryScope[]
  readonly section?: string
  readonly pathPrefix?: string
  /** Deepest heading level to list, 1 to 4. */
  readonly depth?: number
}

/** One matched or requested node. */
export interface SearchHit {
  readonly view: NodeView
  /** Number of distinct patterns that matched. */
  readonly matchedPatterns: number
  readonly titleHit: boolean
  /** Zero-based body line indexes with a match. */
  readonly hitLines: ReadonlySet<number>
  /** One-based page shown. */
  readonly page: number
  readonly pages: number
  /** Body text of the shown page with hit lines marked. */
  readonly text: string
}

/** One page of search results. */
export interface SearchPage {
  readonly hits: readonly SearchHit[]
  /** Total matched nodes. */
  readonly total: number
  /** Offset of the first hit on this page. */
  readonly offset: number
  /** Number of patterns in the query; zero for an id read. */
  readonly patternCount: number
  /** Notes about unavailable scopes. */
  readonly notes: readonly string[]
}

/** Marker placed before body lines that contain a match. */
const HIT_MARKER = '>> '

/** Search the visible scopes and return one page of hits. */
export function searchNodes(documents: ScopeDocuments, request: SearchRequest): SearchPage {
  const patterns = request.patterns ?? []
  const ids = request.ids ?? []
  const hasPatterns = patterns.some(pattern => pattern !== '')
  if (hasPatterns === (ids.length > 0)) throw MemoryError.invalid('Give either `patterns` or `ids`, not both and not neither.')
  if (patterns.length > MAX_SEARCH_PATTERNS) throw MemoryError.invalid(`At most ${MAX_SEARCH_PATTERNS} patterns are allowed.`)
  const limit = Math.min(Math.max(request.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT)
  const { views: visible, notes } = visibleViews(documents, request.scopes ?? [])
  const views = filterViews(visible, request.section, request.pathPrefix)

  if (ids.length > 0) {
    const pageRequest = parseCursor(request.cursor)
    if (pageRequest > 1 && ids.length !== 1) throw MemoryError.invalid('A page cursor with `ids` needs exactly one id.')
    const hits = ids.map(id => {
      const view = views.find(candidate => candidate.id === id)
      if (view === undefined) throw MemoryError.notFound(id)
      return pagedHit(view, 0, false, new Set(), Math.max(pageRequest, 1))
    })
    return { hits, total: hits.length, offset: 0, patternCount: 0, notes }
  }

  const ignoreCase = request.ignoreCase ?? true
  const regexes = patterns.filter(pattern => pattern !== '').map(pattern => compile(pattern, request.fixedStrings ?? false, ignoreCase))
  const matches: { count: number; titleHit: boolean; hitLines: Set<number>; view: NodeView }[] = []
  for (const view of views) {
    const title = viewTitle(view)
    const body = bodyLines(view.body)
    const matched = new Set<number>()
    const hitLines = new Set<number>()
    let titleHit = false
    regexes.forEach((regex, index) => {
      if (regex.test(title)) {
        matched.add(index)
        titleHit = true
      }
      body.forEach((line, lineIndex) => {
        if (regex.test(line)) {
          matched.add(index)
          hitLines.add(lineIndex)
        }
      })
    })
    if (matched.size > 0) matches.push({ count: matched.size, titleHit, hitLines, view })
  }
  matches.sort((left, right) => right.count - left.count
    || Number(right.titleHit) - Number(left.titleHit)
    || scopePriority(right.view.scope) - scopePriority(left.view.scope)
    || compare(updated(right.view), updated(left.view)))
  const offset = parseCursor(request.cursor) - 1
  const hits = matches.slice(offset, offset + limit).map(match => pagedHit(match.view, match.count, match.titleHit, match.hitLines, undefined))
  return { hits, total: matches.length, offset, patternCount: regexes.length, notes }
}

/** Render a search page as model-facing text. */
export function renderSearchPage(page: SearchPage): string {
  const output = [...page.notes]
  if (page.total === 0) {
    output.push('No memory node matched. Try other wording or synonyms, or list titles with memory_outline.')
    return output.join('\n')
  }
  if (page.patternCount > 0) output.push(`${page.total} node(s) matched; showing ${page.offset + 1}-${page.offset + page.hits.length}.`)
  for (const hit of page.hits) {
    const view = hit.view
    output.push('', `## [${view.scope}] ${view.path.join(' › ')}`)
    const facts = [`id: ${view.id}`, `revision: ${view.revision}`]
    if (view.meta !== undefined) {
      facts.push(`updated: ${view.meta.updated.replace('T', ' ').replace(/Z+$/, '')}`, `source: ${view.meta.source}`)
    }
    if (page.patternCount > 0) facts.push(`matched: ${hit.matchedPatterns}/${page.patternCount} patterns${hit.titleHit ? ' (title)' : ''}`)
    output.push(facts.join(' · '))
    if (hit.text !== '') output.push(hit.text)
    if (view.children.length > 0) output.push(`children: ${view.children.join(' · ')}`)
    if (hit.pages > 1) {
      const next = hit.page < hit.pages ? `; continue with ids=["${view.id}"] and cursor="${hit.page + 1}"` : ''
      output.push(`page ${hit.page}/${hit.pages}${next}`)
    }
  }
  const shown = page.offset + page.hits.length
  if (page.patternCount > 0 && shown < page.total) output.push('', `More nodes matched; continue with cursor="${shown + 1}".`)
  return output.join('\n')
}

/** Render the heading tree of the visible scopes. */
export function renderOutline(documents: ScopeDocuments, request: OutlineRequest): string {
  const depth = request.depth ?? MAX_NODE_LEVEL
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_NODE_LEVEL) throw MemoryError.invalid(`\`depth\` must be between 1 and ${MAX_NODE_LEVEL}.`)
  const { views: visible, notes } = visibleViews(documents, request.scopes ?? [])
  const views = filterViews(visible, request.section, request.pathPrefix)
  const output = [...notes]
  for (const scope of SCOPES) {
    const scopeViews = views.filter(view => view.scope === scope)
    if (scopeViews.length === 0) continue
    const label = scope === 'project' && documents.project !== undefined ? `project ${documents.project.project.name}` : scope
    if (output.length > 0) output.push('')
    output.push(`[${label}] ${scopeViews.length} node(s)`)
    for (const view of scopeViews.filter(candidate => candidate.level <= depth)) {
      const facts = [view.id, `r:${view.revision}`]
      if (view.meta !== undefined) {
        facts.push([...view.meta.updated].slice(0, 10).join(''))
        if (view.meta.section !== undefined) facts.push(`section:${view.meta.section}`)
      }
      if (view.body !== '') facts.push(`${byteLength(view.body)} B`)
      if (view.level === depth && view.descendants > 0) facts.push(`+${view.descendants} below`)
      output.push(`${'#'.repeat(view.level)} ${viewTitle(view)} (${facts.join(' · ')})`)
    }
  }
  if (output.length === 0) output.push('Memory is empty. Record durable facts with memory_write.')
  return output.join('\n')
}

/** Views of the requested scopes, and notes for unavailable ones. */
function visibleViews(documents: ScopeDocuments, scopes: readonly MemoryScope[]): { views: NodeView[]; notes: string[] } {
  const views: NodeView[] = []
  const notes: string[] = []
  for (const scope of scopes.length === 0 ? SCOPES : scopes) {
    const document = scopeDocument(documents, scope)
    if (document !== undefined) views.push(...document.views(scope))
    else if (scopes.length > 0) notes.push('[project] No project memory exists yet; it is created by the first project write.')
  }
  return { views, notes }
}

/** Apply section and path-prefix filters. */
function filterViews(views: NodeView[], section: string | undefined, pathPrefix: string | undefined): NodeView[] {
  const wanted = section?.trim() || undefined
  const prefix = (pathPrefix ?? '').split(/[/›]/).map(segment => segment.trim().toLowerCase()).filter(segment => segment !== '')
  return views
    .filter(view => wanted === undefined || view.section === wanted || (view.path[0] !== undefined && asciiLower(view.path[0]) === asciiLower(wanted)))
    .filter(view => prefix.length <= view.path.length && prefix.every((segment, index) => view.path[index]?.toLowerCase() === segment))
}

/** Rust `eq_ignore_ascii_case` compares with only ASCII letters folded. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, letter => letter.toLowerCase())
}

/**
 * Compile one pattern. VulcanCode uses Rust's `regex` crate; JavaScript's Unicode regex accepts
 * the same common syntax (classes, alternation, anchors, `\b`, `\d`, `\w`, `\s`).
 */
function compile(pattern: string, fixed: boolean, ignoreCase: boolean): RegExp {
  const source = fixed ? escapeRegex(pattern) : pattern
  try {
    return new RegExp(source, ignoreCase ? 'iu' : 'u')
  } catch (error) {
    throw MemoryError.invalid(`Pattern \`${pattern}\` is not a valid regex (${error instanceof Error ? error.message : String(error)}); set fixedStrings for literal text.`)
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')
}

/** Parse a one-based cursor; absent means 1. */
function parseCursor(cursor: string | undefined): number {
  const text = cursor?.trim() ?? ''
  if (text === '') return 1
  const value = /^\+?\d+$/.test(text) ? Number(text) : Number.NaN
  if (!Number.isSafeInteger(value) || value < 1) throw MemoryError.invalid(`Cursor \`${text}\` is not a page number.`)
  return value
}

/** A node's update time for ordering; nodes without metadata sort last. */
function updated(view: NodeView): string {
  return view.meta?.updated ?? ''
}

/** A hit showing the requested page, or the page of the first hit line. */
function pagedHit(view: NodeView, matchedPatterns: number, titleHit: boolean, hitLines: ReadonlySet<number>, requestedPage: number | undefined): SearchHit {
  const body = bodyLines(view.body)
  const pages = pageRanges(body)
  const pageCount = Math.max(pages.length, 1)
  let page: number
  if (requestedPage !== undefined) {
    if (requestedPage > pageCount) throw MemoryError.invalid(`Node \`${view.id}\` has ${pageCount} page(s).`)
    page = requestedPage
  } else {
    const first = Math.min(...hitLines)
    const index = pages.findIndex(([start, end]) => first >= start && first < end)
    page = index < 0 ? 1 : index + 1
  }
  const range = pages[page - 1]
  const text = range === undefined
    ? ''
    : body.slice(range[0], range[1]).map((line, offset) => hitLines.has(range[0] + offset) ? `${HIT_MARKER}${line}` : line).join('\n')
  return { view, matchedPatterns, titleHit, hitLines, page, pages: pageCount, text }
}

/** Split body lines into `[start, end)` pages of at most {@link NODE_PAGE_BYTES}, breaking only between lines. */
function pageRanges(body: readonly string[]): [number, number][] {
  const pages: [number, number][] = []
  let start = 0
  let bytes = 0
  body.forEach((line, index) => {
    const cost = byteLength(line) + 1
    if (index > start && bytes + cost > NODE_PAGE_BYTES) {
      pages.push([start, index])
      start = index
      bytes = 0
    }
    bytes += cost
  })
  if (start < body.length) pages.push([start, body.length])
  return pages
}
