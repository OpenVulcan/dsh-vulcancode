import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { parseAnswerComponent, type AnswerComponent } from './answer-model.js'
import { ANSWER_CHART_MAX_SERIES, ANSWER_COMPONENT_MAX_ROWS } from './limits.js'

/** Parse a fence written as `language meta`. */
function parse(info: string, body: string): AnswerComponent | null {
  const [language = '', ...meta] = info.split(' ')
  return parseAnswerComponent(language, meta.join(' '), body)
}

/**
 * Assert that `actual` contains `expected`: objects compare by the listed keys only, arrays element by
 * element with equal length, and an `undefined` expectation accepts an absent or undefined value.
 */
function matches(actual: unknown, expected: unknown, path = '$'): void {
  if (expected === undefined) {
    assert.equal(actual, undefined, `${path}: expected undefined`)
    return
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path}: expected an array`)
    assert.equal(actual.length, expected.length, `${path}: length`)
    expected.forEach((item, index) => matches(actual[index], item, `${path}[${index}]`))
    return
  }
  if (typeof expected === 'object' && expected !== null) {
    assert.ok(typeof actual === 'object' && actual !== null, `${path}: expected an object`)
    for (const [key, value] of Object.entries(expected)) matches((actual as Record<string, unknown>)[key], value, `${path}.${key}`)
    return
  }
  assert.equal(actual, expected, path)
}

describe('parseAnswerComponent', () => {
  test('rejects unknown names, unsupported names and blank bodies', () => {
    assert.equal(parse('ui-unknown', 'a | b'), null)
    assert.equal(parse('ui-kv', '  \n '), null)
    assert.equal(parse('ui-callout', 'body'), null)
    assert.equal(parse('ui-details', 'body'), null)
    assert.equal(parse('ui-code', 'src/a.rs:1-3'), null)
    assert.equal(parse('ui-gallery', 'a.png | caption'), null)
  })

  test('reads text after a row component name as its heading', () => {
    matches(parse('ui-kv Round trip', 'a | b'), { kind: 'kv', heading: 'Round trip', rows: [{ label: 'a', value: 'b' }] })
    assert.equal(parse('ui-kv', 'a | b')?.heading, undefined)
    assert.equal(parse('ui-checklist Checks', 'ok | item')?.heading, 'Checks')
    assert.equal(parse('ui-kv Round trip', 'a | b | c'), null)
  })

  test('rejects rows with empty cells, wrong cell counts or unknown status words', () => {
    assert.equal(parse('ui-kv', 'a | '), null)
    assert.equal(parse('ui-kv', 'a | b | c'), null)
    assert.equal(parse('ui-checklist', 'done | item'), null)
    assert.equal(parse('ui-steps', 'ok | step'), null)
    assert.equal(parse('ui-findings', 'critical | issue'), null)
  })

  test('enforces the shared row limit', () => {
    const rows = (count: number) => Array.from({ length: count }, (_, index) => `k${index} | v`).join('\n')
    assert.notEqual(parse('ui-kv', rows(ANSWER_COMPONENT_MAX_ROWS)), null)
    assert.equal(parse('ui-kv', rows(ANSWER_COMPONENT_MAX_ROWS + 1)), null)
  })

  test('skips a Markdown separator row and optional outer pipes', () => {
    matches(parse('ui-kv', '| a | b |\n|---|---|\n| c | d |'), { kind: 'kv', rows: [{ label: 'a', value: 'b' }, { label: 'c', value: 'd' }] })
  })

  test('validates metric meters and splits a trailing tone word', () => {
    const metrics = parse('ui-metrics', 'Coverage | 80 | 100 | % | ok\nOpen | 3 | warn')
    matches(metrics, { kind: 'metrics', rows: [{ numeric: 80, maximum: 100, unit: '%', tone: 'ok' }, { value: '3', tone: 'warn' }] })
    assert.equal(parse('ui-metrics', 'Coverage | high | 100'), null)
    assert.equal(parse('ui-metrics', 'Coverage | 1 | 0'), null)
    assert.equal(parse('ui-metrics', 'Coverage | -1 | 100'), null)
  })

  test('marks a value above its maximum as an overrun whose tone defaults to no', () => {
    matches(parse('ui-metrics', 'Images | 620 | 500 | KB\nScripts | 200 | 170 | KB | warn\nFonts | 40 | 50'), {
      kind: 'metrics', rows: [{ over: true, tone: 'no' }, { over: true, tone: 'warn' }, { over: false, tone: undefined }],
    })
  })

  test('reads entity tables, field keys and references, and rejects unknown targets', () => {
    const er = parse('ui-er', 'User | accounts\n  id PK\n  email string UK\n+ Order\n  user_id -> User\n  ~ total decimal(10, 2) | gross')
    matches(er, {
      kind: 'er', horizontal: true, tables: [
        { name: 'User', note: 'accounts', fields: [{ name: 'id', keys: ['PK'] }, { name: 'email', type: 'string', keys: ['UK'] }] },
        { name: 'Order', mark: 'add', fields: [{ name: 'user_id', keys: ['FK'], target: 0 }, { name: 'total', type: 'decimal(10, 2)', note: 'gross', mark: 'chg' }] },
      ],
    })
    matches(parse('ui-er TB', 'A\n  id PK'), { horizontal: false })
    assert.equal(parse('ui-er', 'A\n  b_id -> B'), null)
    assert.equal(parse('ui-er', '  id PK\nA'), null)
    assert.equal(parse('ui-er', 'A\nA'), null)
    assert.equal(parse('ui-er RL', 'A'), null)
  })

  test('splits formula lines from a legend after the first blank line', () => {
    matches(parse('ui-math Little\'s law', 'L = \\lambda W\n\\rho = \\lambda / \\mu\n\nL | Requests in system\n\\lambda | Arrival rate'), {
      kind: 'math', title: 'Little\'s law', equations: ['L = \\lambda W', '\\rho = \\lambda / \\mu'],
      symbols: [{ symbol: 'L', meaning: 'Requests in system' }, { symbol: '\\lambda', meaning: 'Arrival rate' }],
    })
    matches(parse('ui-math', '\\begin{aligned}\na &= b \\\\\n&= c\n\\end{aligned}'), { equations: ['\\begin{aligned}\na &= b \\\\\n&= c\n\\end{aligned}'] })
    matches(parse('ui-math', '|x| = 1'), { equations: ['|x| = 1'], symbols: [] })
    // Lines after the blank line are further formulas when none is a legend row; a mix is invalid.
    matches(parse('ui-math', 'r = a\n\nr = b'), { equations: ['r = a', 'r = b'], symbols: [] })
    assert.equal(parse('ui-math', 'x = 1\n\nx | ok\ny'), null)
  })

  test('sums file deltas, one-sided counts and change labels', () => {
    matches(parse('ui-files', 'a.rs | +9 -2 | note\nb.rs | +1 −0\nc.md | only a note'), {
      kind: 'files', added: 10, removed: 2, files: [{ added: 9, note: 'note' }, { removed: 0 }, { note: 'only a note' }],
    })
    matches(parse('ui-files', 'a.ts | +145 | entry\nb.ts | -3\nc.ts | new | id'), {
      kind: 'files', added: 145, removed: 3, files: [
        { added: 145, removed: undefined, note: 'entry' },
        { added: undefined, removed: 3 },
        { status: 'new', note: 'id', added: undefined },
      ],
    })
  })

  test('reads a lone non-numeric third metric cell as a unit and empty maximum or unit cells as absent', () => {
    matches(parse('ui-metrics', 'Scan | 10.9 | s'), { rows: [{ value: '10.9', unit: 's', maximum: undefined }] })
    matches(parse('ui-metrics', 'Raw | 506 s | | | no\nSize | 0.96 | | MB | ok\nCoverage | 81 | 100 | | ok'), {
      rows: [
        { value: '506 s', unit: undefined, maximum: undefined, tone: 'no' },
        { value: '0.96', unit: 'MB', maximum: undefined, tone: 'ok' },
        { numeric: 81, maximum: 100, unit: undefined, tone: 'ok' },
      ],
    })
    assert.equal(parse('ui-metrics', ' | 80'), null)
    assert.equal(parse('ui-metrics', 'Label | '), null)
  })

  test('accepts a path-shaped fourth checklist cell as its location only', () => {
    matches(parse('ui-checklist', 'no | item | note | src/a.rs:150'), {
      items: [{ status: 'no', item: 'item', note: 'note', location: 'src/a.rs:150' }],
    })
    assert.equal(parse('ui-checklist', 'no | item | note | more prose'), null)
  })

  test('parses compare matrices with tone cells and requires matching widths', () => {
    matches(parse('ui-compare', 'Criterion | A | B\nCost | ok Cheap | no'), {
      kind: 'compare', rows: [{ criterion: 'Cost', cells: [{ tone: 'ok', text: 'Cheap' }, { tone: 'no', text: '' }] }],
    })
    assert.equal(parse('ui-compare', 'Criterion | A\nCost | ok'), null)
    assert.equal(parse('ui-compare', 'Criterion | A | B\nCost | ok'), null)
  })

  test('keeps escaped, code and word-joined pipes inside a cell', () => {
    matches(parse('ui-findings', 'info | runs fetch\\|iex | src/a.rs'), { kind: 'findings', rows: [{ text: 'runs fetch|iex', location: 'src/a.rs' }] })
    matches(parse('ui-findings', 'info | adversarial (fetch|iex) cases | src/a.rs'), {
      kind: 'findings', rows: [{ text: 'adversarial (fetch|iex) cases', location: 'src/a.rs' }],
    })
    matches(parse('ui-compare', 'Criterion | A | B\nExample | `a | b` | Invoke-WebRequest|iex'), {
      kind: 'compare', rows: [{ cells: [{ text: '`a | b`' }, { text: 'Invoke-WebRequest|iex' }] }],
    })
    // Spaced pipes still separate cells, so a genuinely extra column is rejected.
    assert.equal(parse('ui-compare', 'Criterion | A | B\nCost | ok | no | extra'), null)
  })

  test('validates chart kinds, series counts and value signs', () => {
    matches(parse('ui-chart bar Weekly', 'Week | New | Fixed\nW1 | 3 | 2%'), {
      kind: 'chart', chart: { kind: 'bar', title: 'Weekly', categoryLabel: 'Week', series: ['New', 'Fixed'], rows: [{ values: [3, 2] }] },
    })
    assert.equal(parse('ui-chart radar', 'A | B\nx | 1'), null)
    assert.equal(parse('ui-chart pie', 'A | B | C\nx | 1 | 2'), null)
    assert.equal(parse('ui-chart pie', 'A | B\nx | -1\ny | 3'), null)
    assert.equal(parse('ui-chart donut', 'A | B\nx | 0'), null)
    assert.equal(parse('ui-chart bar', 'A | B\nx | many'), null)
    const header = ['Category', ...Array.from({ length: ANSWER_CHART_MAX_SERIES + 1 }, (_, index) => `S${index}`)]
    assert.equal(parse('ui-chart line', `${header.join(' | ')}\n${['x', ...header.slice(1).map(() => '1')].join(' | ')}`), null)
  })

  test('requires at least two nonempty sections for tabs and columns', () => {
    matches(parse('ui-tabs', '### A\none\n### B\ntwo'), { kind: 'tabs', sections: [{ title: 'A', body: 'one' }, { title: 'B', body: 'two' }] })
    assert.equal(parse('ui-columns', '### A\none'), null)
    assert.equal(parse('ui-tabs', 'intro\n### A\none\n### B\ntwo'), null)
    assert.equal(parse('ui-tabs', '### A\n### B\ntwo'), null)
  })

  test('nests tree nodes by indentation and reads plan markers', () => {
    matches(parse('ui-tree', 'src\n  + new.ts | added\n  - old.ts\n  \\- dash.ts'), {
      kind: 'tree', nodes: [{ label: 'src', children: [{ label: 'new.ts', note: 'added', mark: 'add' }, { label: 'old.ts', mark: 'del' }, { label: '- dash.ts' }] }],
    })
  })

  test('treats the same flow label as one node and keeps lone declarations out of the drawing', () => {
    const flow = parse('ui-flow LR', '(Start) -> {Valid?} -> Save: yes\nValid? --> Reject & Log: no\n~ Save\n+ Save -> Notify')
    assert.ok(flow?.kind === 'flow')
    assert.equal(flow.horizontal, true)
    assert.deepEqual(flow.nodes.map((node) => [node.label, node.shape]), [
      ['Start', 'terminal'], ['Valid?', 'decision'], ['Save', 'box'], ['Reject', 'box'], ['Log', 'box'], ['Notify', 'box'],
    ])
    assert.equal(flow.nodes.find((node) => node.label === 'Save')?.mark, 'chg')
    assert.equal(flow.nodes.find((node) => node.label === 'Notify')?.mark, 'add')
    assert.equal(flow.chains.length, 3)
    matches(flow.chains[1], { groups: [[1], [3, 4]], dashed: [true], label: 'no' })
    assert.equal(parse('ui-flow TB', 'A -> B'), null)
    assert.equal(parse('ui-flow', 'A -> '), null)
  })

  test('reads a Mermaid node ID as the node it names, keeping call-like labels as text', () => {
    const flow = parse('ui-flow', 'A([Start]) -> B{OK?}\nB -> C[(Orders)]: yes\nB --> D[Retry]\nD -> B')
    assert.ok(flow?.kind === 'flow')
    assert.deepEqual(flow.nodes.map((node) => [node.label, node.shape]), [
      ['Start', 'terminal'], ['OK?', 'decision'], ['Orders', 'store'], ['Retry', 'box'],
    ])
    assert.deepEqual(flow.chains.map((chain) => chain.groups), [[[0], [1]], [[1], [2]], [[1], [3]], [[3], [1]]])
    const calls = parse('ui-flow', 'load(config) -> init() -> run')
    assert.ok(calls?.kind === 'flow')
    assert.deepEqual(calls.nodes.map((node) => node.label), ['load(config)', 'init()', 'run'])
    const referenced = parse('ui-flow', 'S(Start) -> Work\nWork -> S')
    assert.ok(referenced?.kind === 'flow')
    assert.deepEqual(referenced.nodes.map((node) => [node.label, node.shape]), [['Start', 'terminal'], ['Work', 'box']])
  })

  test('orders sequence actors by first use and records direction, notes and phases', () => {
    const sequence = parse('ui-sequence num', '== Login ==\nUser -> API: request\nAPI --> User: token\nnote User, API: cached\n- API -> API: retry')
    matches(sequence, {
      kind: 'sequence', numbered: true, actors: ['User', 'API'], steps: [
        { kind: 'phase', text: 'Login' },
        { kind: 'message', from: 0, to: 1, dashed: false, text: 'request' },
        { kind: 'message', from: 1, to: 0, dashed: true, text: 'token' },
        { kind: 'note', first: 0, last: 1, text: 'cached' },
        { kind: 'message', from: 1, to: 1, mark: 'del', text: 'retry' },
      ],
    })
    assert.equal(parse('ui-sequence', 'User talks to API'), null)
    assert.equal(parse('ui-sequence', 'note User'), null)
  })

  test('accepts the row-component pipe in place of the colon before message, note and flow labels', () => {
    matches(parse('ui-sequence', 'User -> API | request\nnote User, API | cached'), {
      actors: ['User', 'API'], steps: [
        { kind: 'message', from: 0, to: 1, text: 'request' },
        { kind: 'note', first: 0, last: 1, text: 'cached' },
      ],
    })
    matches(parse('ui-flow', 'Build -> Test | on push'), { chains: [{ groups: [[0], [1]], label: 'on push' }] })
  })

  test('reads a decision question, its options and the recommendation', () => {
    matches(parse('ui-decision', 'Cache lifetime?\n* 10 minutes | Matches deploys\n- 1 hour'), {
      kind: 'decision', multiple: false, question: 'Cache lifetime?', options: [
        { label: '10 minutes', note: 'Matches deploys', recommended: true },
        { label: '1 hour', note: undefined, recommended: false },
      ],
    })
    matches(parse('ui-decision multi', 'Also?\n* A\n* B'), { multiple: true })
  })

  test('rejects decisions without two marked options, with repeated labels or with two recommendations', () => {
    assert.equal(parse('ui-decision', 'Q?\n* Only one'), null)
    assert.equal(parse('ui-decision', 'Q?\nA\n- B'), null)
    assert.equal(parse('ui-decision', 'Q?\n- A\n- A'), null)
    assert.equal(parse('ui-decision', 'Q?\n* A\n* B'), null)
    assert.equal(parse('ui-decision', '- Q?\n- A\n- B'), null)
    assert.equal(parse('ui-decision single', 'Q?\n- A\n- B'), null)
  })
})
