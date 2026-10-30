// Translated from the tests in VulcanCode `crates/vulcan-markdown-memory/src/document.rs`.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MemoryDocument, titleRoundTrips, viewTitle } from './document.js'

test('representative files round-trip their exact bytes', () => {
  const samples = [
    '',
    'plain text only\n',
    'intro\n\n# Base\n<!-- mem id=m-1 section=base created=2026-10-01T00:00Z updated=2026-10-02T00:00Z source=ai -->\nbody\n\n## Child\ntext\n```\n# not a heading\n```\n',
    'Title\n=====\n\nsetext body\n\nSub\n---\nmore\n',
    '# A\r\nline\r\n## B\r\nx\r\n',
    '# Tail without newline',
    '> # quoted heading\n\n- # list heading\n\n##### deep\n# Real\n',
    '## Starts at two\n# Then one\n### Skips two\n',
  ]
  for (const sample of samples) assert.equal(MemoryDocument.parse(sample).render(), sample, JSON.stringify(sample))
})

test('nesting follows top-level headings only', () => {
  const document = MemoryDocument.parse('> # quoted\n# One\n## Two\n### Three\n##### Five\n## Two b\n# Uno\n')
  const views = document.views('project')
  assert.deepEqual(views.map(view => view.path.join('/')), ['One', 'One/Two', 'One/Two/Three', 'One/Two b', 'Uno'])
  assert.ok(views[2]?.body.includes('##### Five'))
  assert.ok(document.render().startsWith('> # quoted\n'))
})

test('metadata is read and malformed lines stay body text', () => {
  const document = MemoryDocument.parse(
    '# S\n<!-- mem id=m-a section=base created=2026-10-01T00:00Z updated=2026-10-02T00:00Z session=abc source=user -->\nbody\n## T\n<!-- mem id=m-b -->\nrest\n',
  )
  const [section, child] = document.views('space')
  assert.equal(section?.meta?.id, 'm-a')
  assert.equal(section?.meta?.section, 'base')
  assert.equal(section?.meta?.source, 'user')
  assert.equal(section?.section, 'base')
  assert.equal(section?.id, 'm-a')
  assert.equal(child?.meta, undefined)
  assert.ok(child?.id.startsWith('h-'))
  assert.ok(child?.body.includes('<!-- mem id=m-b -->'))
  assert.equal(child?.section, 'base')
})

test('raw titles keep inline code and drop closing hashes', () => {
  const views = MemoryDocument.parse('# Use `memory_write` ##\n## C#\n### ###\n').views('user')
  assert.deepEqual(views.map(viewTitle), ['Use `memory_write`', 'C#', ''])
  assert.ok(titleRoundTrips(2, 'Use `memory_write`'))
  assert.ok(!titleRoundTrips(2, 'Trailing #'))
  assert.ok(!titleRoundTrips(2, 'Two\nlines'))
})

test('relevel shifts a subtree within the deepest level', () => {
  const document = MemoryDocument.parse('# A\n## B\n### C\n')
  const node = document.remove([0, 0])
  assert.ok(node !== undefined)
  assert.equal(node.relevel(4), 5)
  assert.equal(node.relevel(3), undefined)
  assert.equal(node.relevel(1), undefined)
  assert.ok(document.append(undefined, node))
  assert.equal(document.render(), '# A\n# B\n## C\n')
})

test('revision tracks title and body, not line endings', () => {
  const lf = MemoryDocument.parse('# A\nbody\n\n')
  const crlf = MemoryDocument.parse('# A\r\n\r\nbody\r\n')
  const changed = MemoryDocument.parse('# A\nother\n')
  assert.equal(lf.roots[0]?.revision(), crlf.roots[0]?.revision())
  assert.notEqual(lf.roots[0]?.revision(), changed.roots[0]?.revision())
})

test('revision is sha256 of trimmed title, NUL and normalized body', () => {
  // sha256("A\0body") — the same bytes VulcanCode hashes.
  const node = MemoryDocument.parse('# A\nbody\n').roots[0]
  assert.equal(node?.revision(), 'e5b94420')
})
