// Translated from VulcanCode `crates/vulcan-markdown-memory/src/search/tests.rs`.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MAX_SEARCH_PATTERNS, NODE_PAGE_BYTES, byteLength } from './constants.js'
import { MemoryDocument, lines, viewTitle } from './document.js'
import { renderOutline, renderSearchPage, searchNodes, type SearchRequest } from './search.js'
import type { ScopeDocuments } from './store.js'

function documents(user: string, space: string, project?: string): ScopeDocuments {
  return {
    user: MemoryDocument.parse(user),
    space: MemoryDocument.parse(space),
    ...project === undefined ? {} : {
      project: {
        project: { id: 'p-1', name: 'demo', hostProjectIds: ['host-1'], paths: [], memoryEnabled: true, created: '2026-10-20T00:00Z', updated: '2026-10-20T00:00Z' },
        document: MemoryDocument.parse(project),
      },
    },
  }
}

const patterns = (...values: string[]): SearchRequest => ({ patterns: values })

test('hits rank by patterns, title and scope', () => {
  const docs = documents(
    '# Identity\n\n## Editor\n\nUses neovim.\n',
    '# Conventions\n\n## Rust\n\nRun cargo check and cargo test.\n',
    '# Pitfalls\n\n## Cargo\n\nLinking dominates.\n\n## Tests\n\nUse cargo nextest with rust.\n',
  )
  const page = searchNodes(docs, patterns('cargo', 'rust'))
  assert.deepEqual(page.hits.map(hit => viewTitle(hit.view)), ['Rust', 'Tests', 'Cargo'])
  assert.equal(page.hits[0]?.matchedPatterns, 2)
  assert.ok(page.hits[0]?.titleHit)
  assert.ok(!page.hits[1]?.titleHit)
  assert.ok(lines(page.hits[1]?.text ?? '').some(line => line.startsWith('>> ')))
})

test('a hit belongs to the deepest node', () => {
  const page = searchNodes(documents('# Identity\n\n## Name\n\nAda Lovelace\n', ''), patterns('lovelace'))
  assert.equal(page.total, 1)
  assert.deepEqual(page.hits[0]?.view.path, ['Identity', 'Name'])
})

test('invalid requests are refused', () => {
  const docs = documents('', '')
  assert.throws(() => searchNodes(docs, {}))
  assert.throws(() => searchNodes(docs, { ...patterns('x'), ids: ['m-1'] }))
  assert.throws(() => searchNodes(docs, patterns('(')))
  assert.doesNotThrow(() => searchNodes(docs, { ...patterns('('), fixedStrings: true }))
  assert.throws(() => searchNodes(docs, patterns(...Array<string>(MAX_SEARCH_PATTERNS + 1).fill('a'))))
})

test('literal patterns escape every regex metacharacter', () => {
  const docs = documents('# Notes\n\nuse a-b.c (x) [y] {z} | $1 ^ \\ / *+?\n', '')
  for (const literal of ['a-b.c', '(x)', '[y]', '{z}', '|', '$1', '^', '\\', '/', '*+?']) {
    assert.equal(searchNodes(docs, { ...patterns(literal), fixedStrings: true }).total, 1, literal)
  }
})

test('results page with a cursor', () => {
  const space = [1, 2, 3, 4, 5].map(index => `## Note ${index}\n\nshared term\n`).join('\n')
  const docs = documents('', `# Notes\n\n${space}`)
  const first: SearchRequest = { ...patterns('shared'), limit: 2 }
  const page = searchNodes(docs, first)
  assert.deepEqual([page.total, page.hits.length, page.offset], [5, 2, 0])
  assert.ok(renderSearchPage(page).includes('cursor="3"'))
  const next = searchNodes(docs, { ...first, cursor: '3' })
  assert.deepEqual([next.hits.length, next.offset], [2, 2])
})

test('a long node pages by id', () => {
  const line = 'x'.repeat(99)
  const body = Array<string>(Math.floor(NODE_PAGE_BYTES / 100) * 2 + 10).fill(line).join('\n')
  const docs = documents(`# Big\n\n${body}\n`, '')
  const id = docs.user.views('user')[0]!.id
  const page = searchNodes(docs, { ids: [id] })
  const hit = page.hits[0]!
  assert.deepEqual([hit.page, hit.pages], [1, 3])
  assert.ok(byteLength(hit.text) <= NODE_PAGE_BYTES)
  assert.ok(lines(hit.text).every(text => text.length === line.length))
  assert.equal(searchNodes(docs, { ids: [id], cursor: '3' }).hits[0]?.page, 3)
  assert.throws(() => searchNodes(docs, { ids: [id], cursor: '4' }))
})

test('filters narrow results', () => {
  const docs = documents('', '# Conventions\n\n## Git\n\nterm\n\n### Hooks\n\nterm\n\n# Environment\n\n## Shell\n\nterm\n')
  assert.equal(searchNodes(docs, { ...patterns('term'), section: 'environment' }).total, 1)
  assert.equal(searchNodes(docs, { ...patterns('term'), pathPrefix: 'conventions / git' }).total, 2)
})

test('the outline respects depth', () => {
  const docs = documents('', '# Conventions\n\n## Git\n\n### Hooks\n\nbody\n', '# Pitfalls\n')
  const shallow = renderOutline(docs, { depth: 1 })
  assert.ok(lines(shallow).some(line => line.startsWith('# Conventions') && line.includes('+2')))
  assert.ok(!lines(shallow).some(line => line.startsWith('## ')))
  assert.ok(shallow.includes('[project demo]'))
  assert.ok(lines(renderOutline(docs, {})).some(line => line.startsWith('### Hooks')))
  assert.throws(() => renderOutline(docs, { depth: 5 }))
})

test('an empty result renders a hint', () => {
  const page = searchNodes(documents('# Identity\n', ''), patterns('absent'))
  assert.equal(page.total, 0)
  assert.notEqual(renderSearchPage(page), '')
})
