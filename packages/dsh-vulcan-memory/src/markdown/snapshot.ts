/** Injection snapshot: full-text parts, catalogs and their budget usage (`snapshot.rs`). */

import type { InjectionBudget } from '../settings.js'
import { BUDGET_WARNING_PERCENT } from './constants.js'
import { lines, viewTitle, type MemoryDocument, type NodeView } from './document.js'
import { BASE_SECTION_KEY, hasBaseSection, type MemoryScope } from './scope.js'
import type { ScopeDocuments } from './store.js'
import { estimateTokens } from './tokens.js'

/** One budgeted part of the injection. */
export type BudgetPart = 'user' | 'spaceBase' | 'projectBase' | 'spaceCatalog' | 'projectCatalog'

const PART_LABELS: Record<BudgetPart, string> = {
  user: 'user profile',
  spaceBase: 'space base',
  projectBase: 'project base',
  spaceCatalog: 'space catalog',
  projectCatalog: 'project catalog',
}

/** Usage of one budget part. */
export interface BudgetUsage {
  readonly part: BudgetPart
  /** Tokens the full content needs. */
  readonly tokens: number
  /** Configured budget. */
  readonly budget: number
  /** Titles left out of a full-text part, or the catalog depth that was dropped. */
  readonly omitted: readonly string[]
}

/** Whether content needs more than the budget. */
export function overBudget(usage: BudgetUsage): boolean {
  return usage.tokens > usage.budget
}

/** Whether usage reached the warning ratio without exceeding the budget. */
export function nearBudget(usage: BudgetUsage): boolean {
  return !overBudget(usage) && usage.budget > 0 && usage.tokens * 100 >= usage.budget * BUDGET_WARNING_PERCENT
}

/** One usage line for a write receipt. */
export function renderUsageLine(usage: BudgetUsage): string {
  const percent = usage.budget === 0 ? 0 : Math.floor(usage.tokens * 100 / usage.budget)
  return `Injected ${PART_LABELS[usage.part]}: ${usage.tokens}/${usage.budget} tokens (${percent}%).`
}

/** The text injected at the start of a session and after compaction, with its usage. */
export interface InjectionSnapshot {
  /** Model-facing snapshot text; empty when every scope is empty. */
  readonly content: string
  /** Usage of every part that has content. */
  readonly usage: readonly BudgetUsage[]
}

/** Usage of the full-text part of a scope, for write receipts. */
export function baseUsage(scope: MemoryScope, document: MemoryDocument, budget: InjectionBudget): BudgetUsage {
  return fitFullText(fullTextEntries(document.views(scope), scope), fullTextPart(scope), budget).usage
}

/** The injection snapshot of every visible scope. */
export function buildInjectionSnapshot(documents: ScopeDocuments, budget: InjectionBudget): InjectionSnapshot {
  const sections: string[] = []
  const usage: BudgetUsage[] = []
  const scopes: [MemoryScope, MemoryDocument, string][] = [['user', documents.user, 'user'], ['space', documents.space, 'space']]
  if (documents.project !== undefined) scopes.push(['project', documents.project.document, `project ${documents.project.project.name}`])
  for (const [scope, document, label] of scopes) {
    const views = document.views(scope)
    const entries = fullTextEntries(views, scope)
    if (entries.length > 0) {
      const fitted = fitFullText(entries, fullTextPart(scope), budget)
      sections.push(`${hasBaseSection(scope) ? `[${label} base]` : `[${label}]`}\n${fitted.text}`)
      usage.push(fitted.usage)
    }
    if (hasBaseSection(scope)) {
      const catalog = fitCatalog(views, scope === 'space' ? 'spaceCatalog' : 'projectCatalog', budget)
      if (catalog !== undefined) {
        const updated = latestUpdate(views)
        sections.push(`[${label} catalog${updated === undefined ? '' : ` · updated ${updated}`}]\n${catalog.text}`)
        usage.push(catalog.usage)
      }
    }
  }
  if (sections.length === 0) return { content: '', usage }
  return {
    content: `On conflict, project memory overrides space memory, which overrides the user profile. Catalog lines list titles only; read a node with memory_search before relying on it.\n\n${sections.join('\n\n')}`,
    usage,
  }
}

function fullTextPart(scope: MemoryScope): BudgetPart {
  switch (scope) {
    case 'user': return 'user'
    case 'space': return 'spaceBase'
    case 'project': return 'projectBase'
  }
}

/** `[title path, rendered entry]` for every non-empty node injected in full. */
function fullTextEntries(views: readonly NodeView[], scope: MemoryScope): [string, string][] {
  const base = hasBaseSection(scope)
  return views
    .filter(view => view.body !== '')
    .filter(view => !base || view.section === BASE_SECTION_KEY)
    .map(view => {
      const path = base ? view.path.slice(1).join(' › ') : view.path.join(' › ')
      const label = path === '' ? view.path.join(' › ') : path
      const entry = view.body.includes('\n')
        ? `- ${label}:\n${lines(view.body).map(line => line === '' ? '' : `  ${line}`).join('\n')}`
        : `- ${label}: ${view.body}`
      return [label, entry]
    })
}

/** Keep whole entries until the budget is reached and list the omitted titles. */
function fitFullText(entries: readonly [string, string][], part: BudgetPart, budget: InjectionBudget): { text: string; usage: BudgetUsage } {
  const limit = budget[part]
  const total = estimateTokens(entries.map(([, entry]) => entry).join('\n'))
  const kept: string[] = []
  const omitted: string[] = []
  let used = 0
  for (const [label, entry] of entries) {
    const cost = estimateTokens(entry) + 1
    if (omitted.length === 0 && used + cost <= limit) {
      used += cost
      kept.push(entry)
    } else {
      omitted.push(label)
    }
  }
  let text = kept.join('\n')
  if (omitted.length > 0) {
    if (text !== '') text += '\n'
    text += `(over budget; not shown, read with memory_search: ${omitted.join(' · ')})`
  }
  return { text, usage: { part, tokens: total, budget: limit, omitted } }
}

/** The catalog at the deepest level that fits, degrading H3 → H2 → section counts. */
function fitCatalog(views: readonly NodeView[], part: BudgetPart, budget: InjectionBudget): { text: string; usage: BudgetUsage } | undefined {
  const roots = views
    .filter(view => view.locator.length === 1)
    .filter(view => view.section !== BASE_SECTION_KEY)
    .filter(view => view.descendants > 0 || view.body !== '')
  if (roots.length === 0) return undefined
  const limit = budget[part]
  const full = renderCatalog(views, roots, 3)
  const tokens = estimateTokens(full)
  for (const [depth, dropped] of [[3, undefined], [2, 'H3'], [1, 'H2 and H3']] as const) {
    let text = depth === 3 ? full : renderCatalog(views, roots, depth)
    if (estimateTokens(text) <= limit) {
      if (dropped !== undefined) text += '\n(catalog shortened; list it with memory_outline)'
      return { text, usage: { part, tokens, budget: limit, omitted: dropped === undefined ? [] : [dropped] } }
    }
  }
  const output: string[] = []
  let used = 0
  for (const root of roots) {
    const line = catalogLine(views, root, 1)
    const cost = estimateTokens(line) + 1
    if (used + cost > limit) break
    used += cost
    output.push(line)
  }
  output.push(`(catalog shortened, ${roots.length - output.length} more section(s); list them with memory_outline)`)
  return { text: output.join('\n'), usage: { part, tokens, budget: limit, omitted: ['sections'] } }
}

function renderCatalog(views: readonly NodeView[], roots: readonly NodeView[], depth: number): string {
  return roots.map(root => catalogLine(views, root, depth)).join('\n')
}

/** One catalog line: `Section(count) › child [grandchildren] · child`. */
function catalogLine(views: readonly NodeView[], root: NodeView, depth: number): string {
  const line = `${viewTitle(root)}(${root.descendants})`
  if (depth < 2) return line
  const children = directChildren(views, root)
  if (children.length === 0) return line
  const rendered = children.map(child => {
    if (depth < 3) return viewTitle(child)
    const grandchildren = directChildren(views, child).map(viewTitle)
    return grandchildren.length === 0 ? viewTitle(child) : `${viewTitle(child)} [${grandchildren.join(', ')}]`
  })
  return `${line} › ${rendered.join(' · ')}`
}

function directChildren(views: readonly NodeView[], parent: NodeView): NodeView[] {
  return views.filter(view => view.locator.length === parent.locator.length + 1 && parent.locator.every((index, position) => view.locator[position] === index))
}

/** The date part of the newest update time in a scope. */
function latestUpdate(views: readonly NodeView[]): string | undefined {
  let latest: string | undefined
  for (const view of views) {
    const updated = view.meta?.updated
    if (updated !== undefined && (latest === undefined || updated > latest)) latest = updated
  }
  return latest === undefined ? undefined : [...latest].slice(0, 10).join('')
}
