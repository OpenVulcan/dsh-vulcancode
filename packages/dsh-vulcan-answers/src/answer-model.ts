/**
 * Parsed `ui-*` answer component fences. Parsing is pure and total: a fence that does not match its
 * documented syntax returns null, so the caller leaves dsh's ordinary code block in place. The syntax
 * authority is `assets/prompts/answer-mode-interactive.md`.
 *
 * Ported from VulcanCode `apps/vulcan-code-web/src/components/conversation/answer-components/answer-component-model.ts`.
 * `ui-code` (needs the host's answer-time file capture) and `ui-gallery` (needs local image access) are
 * not offered in dsh, so their fences parse as null and stay ordinary code.
 */

import { ANSWER_CHART_MAX_SERIES, ANSWER_COMPONENT_MAX_ROWS } from './limits.js'

/** Tone words that may start a cell. */
export type AnswerTone = 'ok' | 'warn' | 'no'

/** Checklist status: a tone or an open item. */
export type AnswerStatus = AnswerTone | 'todo'

/** Finding severity. */
export type AnswerSeverity = 'high' | 'medium' | 'low' | 'info'

/** Plan step status. */
export type AnswerStepStatus = 'done' | 'now' | 'todo'

/** Callout tones. */
export type AnswerCalloutTone = 'info' | 'success' | 'warning' | 'danger'

/** Plan marker on a tree node, flow node, flow chain or sequence message. */
export type AnswerMark = 'add' | 'del' | 'chg'

/** A cell that may start with a tone word; `text` is empty when the cell is only the tone word. */
export interface AnswerTonedText {
  tone?: AnswerTone | undefined
  text: string
}

/** One metric; `maximum` enables a meter, and `over` marks a value above it. */
export interface AnswerMetric {
  label: string
  value: string
  numeric?: number | undefined
  maximum?: number | undefined
  over?: boolean | undefined
  unit?: string | undefined
  tone?: AnswerTone | undefined
}

/** Key flags of an entity field. */
export type AnswerErKey = 'PK' | 'FK' | 'UK'

/** One entity field; `target` indexes the referenced table. */
export interface AnswerErField {
  name: string
  type?: string | undefined
  keys: AnswerErKey[]
  target?: number | undefined
  note?: string | undefined
  mark?: AnswerMark | undefined
}

/** One entity (table) with its fields. */
export interface AnswerErTable {
  name: string
  note?: string | undefined
  mark?: AnswerMark | undefined
  fields: AnswerErField[]
}

/** One symbol of a formula legend. */
export interface AnswerMathSymbol {
  symbol: string
  meaning: string
}

/** One option of a decision; `recommended` marks the option the answer would pick. */
export interface AnswerDecisionOption {
  label: string
  note?: string | undefined
  recommended: boolean
}

/** One tree node with its nested children. */
export interface AnswerTreeNode {
  label: string
  note?: string | undefined
  mark?: AnswerMark | undefined
  children: AnswerTreeNode[]
}

/** One changed file; `added` and `removed` are present together. */
export interface AnswerFile {
  path: string
  added?: number | undefined
  removed?: number | undefined
  note?: string | undefined
}

/** Chart layouts accepted after `ui-chart`. */
export type AnswerChartKind = 'bar' | 'hbar' | 'stack' | 'line' | 'area' | 'pie' | 'donut'

/** Chart data: series names and one row of values per category. */
export interface AnswerChart {
  kind: AnswerChartKind
  title?: string | undefined
  categoryLabel: string
  series: string[]
  rows: { category: string; values: number[] }[]
}

/** Titled Markdown section of `ui-tabs` or `ui-columns`. */
export interface AnswerSection {
  title: string
  body: string
}

/** Flow node outline. */
export type AnswerFlowShape = 'box' | 'decision' | 'terminal' | 'store'

/** One distinct flow node; the same label is the same node. */
export interface AnswerFlowNode {
  label: string
  shape: AnswerFlowShape
  mark?: AnswerMark | undefined
}

/** One source line of a flow: node groups joined by hops; `label` names the last hop only. */
export interface AnswerFlowChain {
  groups: number[][]
  dashed: boolean[]
  label?: string | undefined
  mark?: AnswerMark | undefined
}

/** One sequence row. */
export type AnswerSequenceStep =
  | { kind: 'phase'; text: string }
  | { kind: 'note'; first: number; last: number; text: string }
  | { kind: 'message'; from: number; to: number; dashed: boolean; text: string; mark?: AnswerMark | undefined }

/** Every renderable component; row components may carry a heading written after their name. */
export type AnswerComponent = AnswerComponentBody & { heading?: string | undefined }

/** Every renderable component without its heading. */
export type AnswerComponentBody =
  | { kind: 'kv'; rows: { label: string; value: string }[] }
  | { kind: 'metrics'; rows: AnswerMetric[] }
  | { kind: 'findings'; rows: { severity: AnswerSeverity; text: string; location?: string | undefined }[] }
  | { kind: 'compare'; header: string[]; rows: { criterion: string; cells: AnswerTonedText[] }[] }
  | { kind: 'checklist'; items: { status: AnswerStatus; item: string; note?: string | undefined }[] }
  | { kind: 'steps'; steps: { status: AnswerStepStatus; title: string; text?: string | undefined }[] }
  | { kind: 'timeline'; rows: { time: string; title: string; text?: string | undefined }[] }
  | { kind: 'cards'; cards: { title: string; text: string; tag?: AnswerTonedText | undefined }[] }
  | { kind: 'files'; files: AnswerFile[]; added: number; removed: number }
  | { kind: 'tree'; nodes: AnswerTreeNode[] }
  | { kind: 'chart'; chart: AnswerChart }
  | { kind: 'flow'; horizontal: boolean; nodes: AnswerFlowNode[]; chains: AnswerFlowChain[] }
  | { kind: 'sequence'; numbered: boolean; actors: string[]; steps: AnswerSequenceStep[] }
  | { kind: 'er'; horizontal: boolean; tables: AnswerErTable[] }
  | { kind: 'math'; title?: string | undefined; equations: string[]; symbols: AnswerMathSymbol[] }
  | { kind: 'decision'; multiple: boolean; question: string; options: AnswerDecisionOption[] }
  | { kind: 'callout'; tone: AnswerCalloutTone; title?: string | undefined; body: string }
  | { kind: 'details'; title: string; body: string }
  | { kind: 'tabs' | 'columns'; sections: AnswerSection[] }

/** Fence languages this plugin renders; any other `ui-*` fence stays ordinary code. */
export const SUPPORTED_ANSWER_LANGUAGES: ReadonlySet<string> = new Set([
  'ui-kv', 'ui-metrics', 'ui-findings', 'ui-compare', 'ui-checklist', 'ui-steps', 'ui-timeline', 'ui-cards',
  'ui-files', 'ui-tree', 'ui-chart', 'ui-flow', 'ui-sequence', 'ui-er', 'ui-math', 'ui-decision',
  'ui-callout', 'ui-details', 'ui-tabs', 'ui-columns',
])

const TONES = new Set<string>(['ok', 'warn', 'no'])
const STATUSES = new Set<string>(['ok', 'warn', 'no', 'todo'])
const SEVERITIES = new Set<string>(['high', 'medium', 'low', 'info'])
const STEP_STATUSES = new Set<string>(['done', 'now', 'todo'])
const CALLOUT_TONES = new Set<string>(['info', 'success', 'warning', 'danger'])
const CHART_KINDS = new Set<string>(['bar', 'hbar', 'stack', 'line', 'area', 'pie', 'donut'])

/** Finite decimal number syntax shared by metrics and charts. */
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu

/**
 * Parse one fence; `language` is `ui-<name>`, `meta` the rest of the info string, `body` the text.
 * Returns null for unknown or unsupported names and for invalid syntax.
 */
export function parseAnswerComponent(language: string, meta: string, body: string): AnswerComponent | null {
  const args = meta.trim()
  if (!body.trim()) return null
  switch (language) {
    case 'ui-kv':
      return titled(args, () => mapRows(body, 2, 2, ([label = '', value = '']) => ({ label, value }), (rows) => ({ kind: 'kv', rows })))
    case 'ui-metrics':
      return titled(args, () => mapRows(body, 2, 5, metric, (rows) => ({ kind: 'metrics', rows })))
    case 'ui-findings':
      return titled(args, () => mapRows(body, 2, 3, ([severity = '', text = '', location]) => (
        SEVERITIES.has(severity) ? { severity: severity as AnswerSeverity, text, location } : null
      ), (rows) => ({ kind: 'findings', rows })))
    case 'ui-compare':
      return titled(args, () => compare(body))
    case 'ui-checklist':
      return titled(args, () => mapRows(body, 2, 3, ([status = '', item = '', note]) => (
        STATUSES.has(status) ? { status: status as AnswerStatus, item, note } : null
      ), (items) => ({ kind: 'checklist', items })))
    case 'ui-steps':
      return titled(args, () => mapRows(body, 2, 3, ([status = '', title = '', text]) => (
        STEP_STATUSES.has(status) ? { status: status as AnswerStepStatus, title, text } : null
      ), (steps) => ({ kind: 'steps', steps })))
    case 'ui-timeline':
      return titled(args, () => mapRows(body, 2, 3, ([time = '', title = '', text]) => ({ time, title, text }), (rows) => ({ kind: 'timeline', rows })))
    case 'ui-cards':
      return titled(args, () => mapRows(body, 2, 3, ([title = '', text = '', tag]) => ({ title, text, tag: tag === undefined ? undefined : toned(tag) }),
        (cards) => ({ kind: 'cards', cards })))
    case 'ui-files':
      return titled(args, () => files(body))
    case 'ui-tree':
      return titled(args, () => tree(body))
    case 'ui-chart':
      return chart(args, body)
    case 'ui-flow':
      return args === '' || args === 'LR' ? flow(args === 'LR', body) : null
    case 'ui-sequence':
      return args === '' || args === 'num' ? sequence(args === 'num', body) : null
    case 'ui-er':
      return args === '' || args === 'LR' || args === 'TB' ? er(args !== 'TB', body) : null
    case 'ui-math':
      return math(args, body)
    case 'ui-decision':
      return args === '' || args === 'multi' ? decision(args === 'multi', body) : null
    case 'ui-callout': {
      const [tone = '', ...title] = args.split(/\s+/u).filter(Boolean)
      if (!CALLOUT_TONES.has(tone)) return null
      return { kind: 'callout', tone: tone as AnswerCalloutTone, title: title.join(' ') || undefined, body }
    }
    case 'ui-details':
      return args ? { kind: 'details', title: args, body } : null
    case 'ui-tabs':
    case 'ui-columns':
      return titled(args, () => sections(language === 'ui-tabs' ? 'tabs' : 'columns', body))
    default:
      return null
  }
}

/** Run `parse` for a row component; text written after the name becomes its heading. */
function titled(args: string, parse: () => AnswerComponent | null): AnswerComponent | null {
  const component = parse()
  return component && args ? { ...component, heading: args } : component
}

/**
 * Split one row into trimmed cells; outer pipes are optional and `\|` is a literal pipe. `lenient` also
 * keeps pipes inside balanced backtick code and pipes touching text on both sides (`fetch|iex`) as literal.
 */
export function answerCells(line: string, lenient = false): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)
  const codeAware = lenient && (text.match(/`/gu)?.length ?? 0) % 2 === 0
  const cells: string[] = []
  let cell = ''
  let inCode = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\\' && text[index + 1] === '|') {
      cell += '|'
      index += 1
    } else if (char === '`') {
      if (codeAware) inCode = !inCode
      cell += char
    } else if (char === '|' && !(inCode || (lenient && /\S/u.test(text[index - 1] ?? ' ') && /\S/u.test(text[index + 1] ?? ' ')))) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell.trim())
  return cells
}

/** Nonblank lines, skipping a Markdown table delimiter row. */
function dataLines(body: string): string[] {
  return body.split(/\r?\n/u).filter((line) => line.trim() && !(line.includes('-') && /^[\s|:-]+$/u.test(line)))
}

/**
 * Cells of a row with `min..=max` nonempty cells, or null. A row with too many cells is split again
 * leniently, since models write unescaped pipes inside commands such as `fetch|iex`.
 */
function rowCells(line: string, min: number, max: number): string[] | null {
  const valid = (cells: string[]) => cells.length >= min && cells.length <= max && cells.every(Boolean)
  const cells = answerCells(line)
  if (valid(cells)) return cells
  if (cells.length <= max) return null
  const lenient = answerCells(line, true)
  return valid(lenient) ? lenient : null
}

/** Parse rows of `min..=max` nonempty cells (trailing cells optional) and wrap them; null when invalid. */
function mapRows<T>(
  body: string,
  min: number,
  max: number,
  row: (cells: string[]) => T | null,
  wrap: (rows: T[]) => AnswerComponent,
): AnswerComponent | null {
  const lines = dataLines(body)
  if (lines.length === 0 || lines.length > ANSWER_COMPONENT_MAX_ROWS) return null
  const rows: T[] = []
  for (const line of lines) {
    const cells = rowCells(line, min, max)
    const parsed = cells === null ? null : row(cells)
    if (parsed === null) return null
    rows.push(parsed)
  }
  return wrap(rows)
}

/** Split a leading tone word from a cell. */
function toned(cell: string): AnswerTonedText {
  const [word = '', ...rest] = cell.split(' ')
  return TONES.has(word) ? { tone: word as AnswerTone, text: rest.join(' ').trim() } : { text: cell }
}

/** A finite number, or null. */
function number(text: string): number | null {
  return NUMBER.test(text) ? Number(text) : null
}

/**
 * `label | value [| maximum [| unit]] [| tone]`; a maximum requires a nonnegative numeric value, and a
 * value above it is an overrun whose tone defaults to `no`.
 */
function metric(input: string[]): AnswerMetric | null {
  const cells = [...input]
  const last = cells[cells.length - 1] ?? ''
  const tone = cells.length > 2 && TONES.has(last) ? cells.pop() as AnswerTone : undefined
  const [label = '', value = '', maximum, unit] = cells
  if (maximum === undefined) return { label, value, tone }
  const numeric = number(value)
  const max = number(maximum)
  if (numeric === null || max === null || max <= 0 || numeric < 0) return null
  const over = numeric > max
  return { label, value, numeric, maximum: max, over, unit, tone: tone ?? (over ? 'no' : undefined) }
}

/** Decision matrix: a header of criterion and at least two options, then one row per criterion. */
function compare(body: string): AnswerComponent | null {
  const [headerLine, ...lines] = dataLines(body)
  if (!headerLine || lines.length === 0 || lines.length > ANSWER_COMPONENT_MAX_ROWS) return null
  const header = rowCells(headerLine, 3, Number.MAX_SAFE_INTEGER)
  if (header === null) return null
  const rows: { criterion: string; cells: AnswerTonedText[] }[] = []
  for (const line of lines) {
    const cells = rowCells(line, header.length, header.length)
    if (cells === null) return null
    rows.push({ criterion: cells[0] ?? '', cells: cells.slice(1).map(toned) })
  }
  return { kind: 'compare', header, rows }
}

/** `path | +added -removed | note` rows; both later cells are optional, totals are summed. */
function files(body: string): AnswerComponent | null {
  let added = 0
  let removed = 0
  return mapRows(body, 1, 3, ([path = '', second, third]): AnswerFile | null => {
    const delta = second === undefined ? null : /^\+(\d+)\s+[-−](\d+)$/u.exec(second)
    if (delta === null && third !== undefined) return null
    if (delta === null) return { path, note: second }
    const file = { path, added: Number(delta[1]), removed: Number(delta[2]), note: third }
    added += file.added
    removed += file.removed
    return file
  }, (rows) => ({ kind: 'files', files: rows, added, removed }))
}

/** Split a leading plan marker (`+ `, `- `, `~ `) from a line; a leading `\` keeps the text literal. */
function change(line: string): { mark?: AnswerMark | undefined; text: string } {
  if (line.startsWith('\\')) return { text: line.slice(1) }
  const marker = /^([+~-]) /u.exec(line)
  if (!marker) return { text: line }
  const mark = marker[1] === '+' ? 'add' : marker[1] === '-' ? 'del' : 'chg'
  return { mark, text: line.slice(2).trimStart() }
}

/** Indentation tree with optional `label | note`; tabs count as four columns. */
function tree(body: string): AnswerComponent | null {
  const lines = body.split(/\r?\n/u).filter((line) => line.trim())
  if (lines.length > ANSWER_COMPONENT_MAX_ROWS) return null
  const roots: AnswerTreeNode[] = []
  const stack: { indent: number; node: AnswerTreeNode }[] = []
  for (const line of lines) {
    const indent = [...(/^\s*/u.exec(line)?.[0] ?? '')].reduce((width, ch) => width + (ch === '\t' ? 4 : 1), 0)
    const { mark, text } = change(line.trim())
    const split = text.indexOf('|')
    const label = (split < 0 ? text : text.slice(0, split)).trim()
    const note = split < 0 ? undefined : text.slice(split + 1).trim() || undefined
    const node: AnswerTreeNode = { label, note, mark, children: [] }
    while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? -1) >= indent) stack.pop()
    const parent = stack[stack.length - 1]
    ;(parent ? parent.node.children : roots).push(node)
    stack.push({ indent, node })
  }
  return { kind: 'tree', nodes: roots }
}

/** `### Title` lines split the body into titled Markdown sections; two or more nonempty sections. */
function sections(kind: 'tabs' | 'columns', body: string): AnswerComponent | null {
  const result: AnswerSection[] = []
  let current: { title: string; lines: string[] } | null = null
  for (const line of body.split(/\r?\n/u)) {
    if (line.startsWith('### ')) {
      if (current) result.push({ title: current.title, body: current.lines.join('\n').trim() })
      current = { title: line.slice(4).trim(), lines: [] }
    } else if (current) {
      current.lines.push(line)
    } else if (line.trim()) {
      return null
    }
  }
  if (current) result.push({ title: current.title, body: current.lines.join('\n').trim() })
  if (result.length < 2 || result.length > ANSWER_COMPONENT_MAX_ROWS || result.some((section) => !section.body)) return null
  return { kind, sections: result }
}

/** `ui-chart <kind> [title]`: header row of category and series names, then one number per series. */
function chart(args: string, body: string): AnswerComponent | null {
  const [kind = '', ...title] = args.split(/\s+/u).filter(Boolean)
  if (!CHART_KINDS.has(kind)) return null
  const [headerLine, ...lines] = dataLines(body)
  if (!headerLine || lines.length === 0 || lines.length > ANSWER_COMPONENT_MAX_ROWS) return null
  const header = rowCells(headerLine, 2, ANSWER_CHART_MAX_SERIES + 1)
  const circular = kind === 'pie' || kind === 'donut'
  if (header === null || (circular && header.length !== 2)) return null
  const rows: AnswerChart['rows'] = []
  for (const line of lines) {
    const cells = rowCells(line, header.length, header.length)
    if (cells === null) return null
    const values = cells.slice(1).map((cell) => number(cell.replace(/%$/u, '').trim()))
    if (values.some((value) => value === null)) return null
    rows.push({ category: cells[0] ?? '', values: values as number[] })
  }
  if ((circular || kind === 'stack') && rows.some((row) => row.values.some((value) => value < 0))) return null
  if (circular && rows.reduce((sum, row) => sum + (row.values[0] ?? 0), 0) <= 0) return null
  return {
    kind: 'chart',
    chart: { kind: kind as AnswerChartKind, title: title.join(' ') || undefined, categoryLabel: header[0] ?? '', series: header.slice(1), rows },
  }
}

/** Split at the first ASCII or full-width colon, or a `|`, into a trimmed head and an optional tail. */
function labelled(text: string): { head: string; tail?: string | undefined } {
  const index = text.search(/[:：|]/u)
  return index < 0 ? { head: text.trim() } : { head: text.slice(0, index).trim(), tail: text.slice(index + 1).trim() }
}

/** Flow node outline and label from one node spec: `[(Store)]`, `{Decision}`, `(Start)`, `[Box]` or plain. */
function flowNode(spec: string): { label: string; shape: AnswerFlowShape } | null {
  const text = spec.trim()
  const outlines: [string, string, AnswerFlowShape][] = [['[(', ')]', 'store'], ['{', '}', 'decision'], ['(', ')', 'terminal'], ['[', ']', 'box']]
  for (const [open, close, shape] of outlines) {
    if (text.length >= open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
      const label = text.slice(open.length, text.length - close.length).trim()
      return label ? { label, shape } : null
    }
  }
  return text ? { label: text, shape: 'box' } : null
}

/** Mermaid node outlines, longer openings first, with the closest `ui-flow` outline. */
const MERMAID_OUTLINES: [string, string, AnswerFlowShape][] = [
  ['([', '])', 'terminal'], ['[[', ']]', 'box'], ['((', '))', 'terminal'], ['{{', '}}', 'box'], ['[/', '/]', 'box'],
  ['[\\', '\\]', 'box'], ['[(', ')]', 'store'], ['[', ']', 'box'], ['(', ')', 'terminal'], ['{', '}', 'decision'],
]

/**
 * A Mermaid-style node `ID[text]`: an identifier followed directly by an outline with nonempty text.
 * `paren` marks the plain `(` outline, which also reads as a call such as `f(x)`.
 */
function mermaidNode(spec: string): { id: string; label: string; shape: AnswerFlowShape; paren: boolean } | null {
  const match = /^([A-Za-z_][\w-]*)([[({].*)$/u.exec(spec)
  if (!match) return null
  const id = match[1] ?? ''
  const outline = match[2] ?? ''
  for (const [open, close, shape] of MERMAID_OUTLINES) {
    if (outline.length >= open.length + close.length && outline.startsWith(open) && outline.endsWith(close)) {
      const label = outline.slice(open.length, outline.length - close.length).trim()
      return label ? { id, label, shape, paren: open === '(' } : null
    }
  }
  return null
}

/**
 * `ui-flow [LR]`: one chain per line; nodes keep their first outline unless a later one is explicit. A
 * Mermaid ID such as `B` in `B{OK?}` names the node `OK?` throughout the fence. A plain `(` outline counts
 * only when its ID also stands alone, so `f(x)` stays text.
 */
function flow(horizontal: boolean, body: string): AnswerComponent | null {
  const lines = dataLines(body)
  if (lines.length === 0 || lines.length > ANSWER_COMPONENT_MAX_ROWS) return null
  const parsedLines = lines.map((line) => {
    const { mark, text } = change(line.trim())
    const parts: string[] = []
    const dashed: boolean[] = []
    let rest = text
    for (let index = rest.indexOf('->'); index >= 0; index = rest.indexOf('->')) {
      const dash = index > 0 && rest[index - 1] === '-'
      parts.push(rest.slice(0, dash ? index - 1 : index))
      dashed.push(dash)
      rest = rest.slice(index + 2)
    }
    if (parts.length === 0) return { mark, groups: [[text.trim()]], dashed, label: undefined, lone: true }
    const { head, tail } = labelled(rest)
    parts.push(head)
    return { mark, groups: parts.map((part) => part.split('&').map((spec) => spec.trim())), dashed, label: tail, lone: false }
  })
  const specs = parsedLines.flatMap((line) => line.groups.flat())
  const standalone = new Set(specs)
  const aliases = new Map<string, string>()
  for (const spec of specs) {
    const mermaid = mermaidNode(spec)
    if (mermaid && (!mermaid.paren || standalone.has(mermaid.id))) aliases.set(mermaid.id, mermaid.label)
  }
  const nodes: AnswerFlowNode[] = []
  const ids = new Map<string, number>()
  const chains: AnswerFlowChain[] = []
  const changed = new Set<number>()
  const node = (spec: string): number | null => {
    const mermaid = mermaidNode(spec)
    const alias = aliases.get(spec)
    const parsed = mermaid && aliases.has(mermaid.id) ? mermaid
      : alias !== undefined ? { label: alias, shape: 'box' as const }
        : flowNode(spec)
    if (parsed === null) return null
    let id = ids.get(parsed.label)
    if (id === undefined) {
      id = nodes.push({ label: parsed.label, shape: 'box' }) - 1
      ids.set(parsed.label, id)
    }
    const entry = nodes[id]
    if (entry && parsed.shape !== 'box') entry.shape = parsed.shape
    return id
  }
  for (const { mark, groups: specGroups, dashed, label, lone } of parsedLines) {
    if (lone) {
      const id = node(specGroups[0]?.[0] ?? '')
      if (id === null) return null
      if (mark === 'chg') changed.add(id)
      chains.push({ groups: [[id]], dashed: [], mark })
      continue
    }
    const groups: number[][] = []
    for (const part of specGroups) {
      const group = part.map(node)
      if (group.some((id) => id === null)) return null
      groups.push(group as number[])
    }
    chains.push({ groups, dashed, label: label || undefined, mark })
  }
  // Nodes drawn only on added (or only on removed) chains carry that marker; `~ Node` lines mark changes.
  const linked = new Set<number>()
  nodes.forEach((entry, id) => {
    const marks = new Set(chains.filter((chain) => chain.groups.length > 1 && chain.groups.some((group) => group.includes(id))).map((chain) => chain.mark))
    if (marks.size > 0) linked.add(id)
    const [only] = [...marks]
    if (marks.size === 1 && (only === 'add' || only === 'del')) entry.mark = only
    if (changed.has(id)) entry.mark = 'chg'
  })
  // A lone node line only declares or marks a node that already appears on a chain.
  const shown = chains.filter((chain) => chain.groups.length > 1 || !linked.has(chain.groups[0]?.[0] ?? -1))
  return { kind: 'flow', horizontal, nodes, chains: shown }
}

/** `ui-sequence [num]`: messages, notes and phases; actors appear in first-use order. */
function sequence(numbered: boolean, body: string): AnswerComponent | null {
  const lines = dataLines(body)
  if (lines.length === 0 || lines.length > ANSWER_COMPONENT_MAX_ROWS) return null
  const actors: string[] = []
  const actor = (name: string): number | null => {
    const trimmed = name.trim()
    if (!trimmed) return null
    const known = actors.indexOf(trimmed)
    return known >= 0 ? known : actors.push(trimmed) - 1
  }
  const steps: AnswerSequenceStep[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (line.length >= 4 && line.startsWith('==') && line.endsWith('==')) {
      steps.push({ kind: 'phase', text: line.slice(2, -2).trim() })
      continue
    }
    if (line.startsWith('note ')) {
      const { head, tail } = labelled(line.slice(5))
      const indexes = head.split(/[,，]/u).map(actor)
      if (tail === undefined || indexes.some((index) => index === null)) return null
      const span = indexes as number[]
      steps.push({ kind: 'note', first: Math.min(...span), last: Math.max(...span), text: tail })
      continue
    }
    const { mark, text } = change(line)
    const index = text.indexOf('->')
    if (index < 0) return null
    const dashed = index > 0 && text[index - 1] === '-'
    const from = actor(text.slice(0, dashed ? index - 1 : index))
    const { head, tail } = labelled(text.slice(index + 2))
    const to = actor(head)
    if (from === null || to === null) return null
    steps.push({ kind: 'message', from, to, dashed, text: tail ?? '', mark })
  }
  return actors.length > 0 ? { kind: 'sequence', numbered, actors, steps } : null
}

const ER_KEYS = new Set<string>(['PK', 'FK', 'UK'])

/** Split a trailing `| note` from a line into a trimmed head and an optional nonempty note. */
function noted(text: string): { head: string; note?: string | undefined } {
  const split = text.indexOf('|')
  if (split < 0) return { head: text.trim() }
  return { head: text.slice(0, split).trim(), note: text.slice(split + 1).trim() || undefined }
}

/**
 * `ui-er [LR|TB]`: unindented lines name tables, indented lines are `name [type] [PK|FK|UK] [-> Table]`
 * fields; every reference must name a table of the same diagram.
 */
function er(horizontal: boolean, body: string): AnswerComponent | null {
  const lines = body.split(/\r?\n/u).filter((line) => line.trim())
  if (lines.length === 0 || lines.length > ANSWER_COMPONENT_MAX_ROWS) return null
  const tables: AnswerErTable[] = []
  const references: { field: AnswerErField; target: string }[] = []
  for (const line of lines) {
    const { mark, text } = change(line.trim())
    const { head, note } = noted(text)
    if (!head) return null
    if (!/^\s/u.test(line)) {
      tables.push({ name: head, note, mark, fields: [] })
      continue
    }
    const table = tables[tables.length - 1]
    if (!table) return null
    const arrow = head.indexOf('->')
    const target = arrow < 0 ? undefined : head.slice(arrow + 2).trim()
    if (target === '') return null
    const [name, ...rest] = (arrow < 0 ? head : head.slice(0, arrow)).trim().split(/\s+/u).filter(Boolean)
    if (!name) return null
    const keys = rest.filter((token) => ER_KEYS.has(token)) as AnswerErKey[]
    if (target !== undefined && !keys.includes('FK')) keys.push('FK')
    const type = rest.filter((token) => !ER_KEYS.has(token)).join(' ') || undefined
    const field: AnswerErField = { name, type, keys, note, mark }
    table.fields.push(field)
    if (target !== undefined) references.push({ field, target })
  }
  const names = tables.map((table) => table.name)
  if (new Set(names).size !== names.length) return null
  for (const reference of references) {
    const index = names.indexOf(reference.target)
    if (index < 0) return null
    reference.field.target = index
  }
  return { kind: 'er', horizontal, tables }
}

/**
 * `ui-math [title]`: formula lines, then after a blank line optional `symbol | meaning` legend rows. Each
 * formula line is one displayed equation unless the formula uses a `\begin` environment.
 */
function math(args: string, body: string): AnswerComponent | null {
  const lines = body.split(/\r?\n/u)
  while (lines.length > 0 && !lines[0]?.trim()) lines.shift()
  const blank = lines.findIndex((line) => !line.trim())
  const formula = (blank < 0 ? lines : lines.slice(0, blank)).map((line) => line.trim())
  const legend = blank < 0 ? [] : dataLines(lines.slice(blank + 1).join('\n'))
  if (formula.length === 0 || formula.length + legend.length > ANSWER_COMPONENT_MAX_ROWS) return null
  const symbols: AnswerMathSymbol[] = []
  for (const line of legend) {
    const cells = rowCells(line, 2, 2)
    if (cells === null) return null
    symbols.push({ symbol: cells[0] ?? '', meaning: cells[1] ?? '' })
  }
  const equations = formula.some((line) => line.includes('\\begin')) ? [formula.join('\n')] : formula
  return { kind: 'math', title: args || undefined, equations, symbols }
}

/**
 * `ui-decision [multi]`: the question line, then option lines `* label | note` (the recommended option)
 * or `- label | note`. Labels are unique; a single choice recommends at most one option.
 */
function decision(multiple: boolean, body: string): AnswerComponent | null {
  const [question = '', ...lines] = body.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  if (/^[*-] /u.test(question) || lines.length < 2 || lines.length > ANSWER_COMPONENT_MAX_ROWS) return null
  const options: AnswerDecisionOption[] = []
  for (const line of lines) {
    const marker = line.slice(0, 2)
    const cells = marker === '* ' || marker === '- ' ? rowCells(line.slice(2), 1, 2) : null
    const label = cells?.[0]
    if (cells === null || label === undefined || options.some((option) => option.label === label)) return null
    options.push({ label, note: cells[1], recommended: marker === '* ' })
  }
  if (!multiple && options.filter((option) => option.recommended).length > 1) return null
  return { kind: 'decision', multiple, question, options }
}
