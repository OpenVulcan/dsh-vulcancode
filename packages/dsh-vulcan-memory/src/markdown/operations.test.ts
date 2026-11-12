// Translated from VulcanCode `crates/vulcan-markdown-memory/src/operations/tests.rs`.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { DEFAULT_BUDGET } from '../settings.js'
import { MemoryError } from './errors.js'
import { parseWriteOperation, renderWriteReceipt, writeMemory, type WriteReceipt } from './operations.js'
import { BASE_SECTION_KEY, presetSections } from './scope.js'
import { MarkdownMemoryStore, type ProjectContext } from './store.js'
import { isUtcMinute } from './timestamp.js'

function setup(): { root: string; store: MarkdownMemoryStore; context: ProjectContext } {
  const root = mkdtempSync(path.join(tmpdir(), 'vulcan-memory-'))
  return { root, store: new MarkdownMemoryStore(root), context: { hostProjectId: 'host-1', rootPath: path.join(root, 'repo') } }
}

function write(store: MarkdownMemoryStore, context: ProjectContext, operations: unknown[]): WriteReceipt {
  return writeMemory(store, context, { session: 'session-1', source: 'ai' }, DEFAULT_BUDGET, operations.map(parseWriteOperation))
}

function caught(run: () => unknown): MemoryError {
  try {
    run()
  } catch (error) {
    if (error instanceof MemoryError) return error
    throw error
  }
  assert.fail('expected a MemoryError')
}

test('operations parse and reject unknown fields', () => {
  const parsed = parseWriteOperation({ action: 'create', scope: 'user', section: 'identity', title: 'Name', body: 'Ada' })
  assert.equal(parsed.action, 'create')
  assert.ok(parsed.action === 'create' && parsed.scope === 'user' && parsed.section !== undefined && !parsed.newSection)
  const moved = parseWriteOperation({ action: 'move', id: 'm-1', expectedRevision: 'abc', parentId: 'm-2' })
  assert.ok(moved.action === 'move' && moved.parentId !== undefined && moved.scope === undefined)
  assert.throws(() => parseWriteOperation({ action: 'replace', id: 'm-1', expectedRevision: 'abc', body: 'x', extra: true }))
  assert.throws(() => parseWriteOperation({ action: 'explode' }))
})

test('create seeds presets and records metadata', () => {
  const { store, context } = setup()
  const receipt = write(store, context, [{ action: 'create', scope: 'user', section: 'identity', title: 'Preferred name', body: 'Call the user Ada.' }])
  assert.equal(receipt.operations.length, 1)
  assert.equal(receipt.createdProject, undefined)
  assert.equal(receipt.usage.length, 1)
  const id = receipt.operations[0]!.id

  const views = store.loadScopes(context).user.views('user')
  assert.deepEqual(views.filter(view => view.level === 1).map(view => view.section), presetSections('user').map(([key]) => key))
  const node = views.find(view => view.id === id)!
  assert.equal(node.level, 2)
  assert.equal(node.body, 'Call the user Ada.')
  assert.equal(node.meta?.source, 'ai')
  assert.equal(node.meta?.session, 'session-1')
  assert.ok(isUtcMinute(node.meta?.updated ?? ''))
})

test('a stale revision rolls back the whole call', () => {
  const { store, context } = setup()
  const first = write(store, context, [{ action: 'create', scope: 'space', section: 'conventions', title: 'Commits', body: 'Use categorized commits.' }])
  const id = first.operations[0]!.id
  const file = store.scopePath('space', undefined)
  const before = readFileSync(file, 'utf8')
  const error = caught(() => write(store, context, [
    { action: 'create', scope: 'space', section: 'conventions', title: 'Branches', body: 'Branch before committing.' },
    { action: 'replace', id, expectedRevision: '00000000', body: 'x' },
  ]))
  assert.equal(error.kind, 'revision_mismatch')
  assert.ok(error.message.startsWith('Operation #2 (counting from 1)'))
  assert.ok(error.message.includes(`current ${first.operations[0]!.revision}`))
  assert.equal(readFileSync(file, 'utf8'), before)
})

// A rejected rename and replace must report the revision readers will see afterward.
// 改名和替换的批次被拒绝时，报错须说明读者随后会看到的修订。
test('rename then replace reports staged and committed revisions without writing', () => {
  const { store, context } = setup()
  const { id, revision } = write(store, context, [
    { action: 'create', scope: 'space', section: 'conventions', title: 'Old title', body: 'Old body' },
  ]).operations[0]!
  const file = store.scopePath('space', undefined)
  const before = readFileSync(file, 'utf8')
  const rename = { action: 'rename', id, expectedRevision: revision, title: 'New title' }
  const replace = { action: 'replace', id, expectedRevision: revision, body: 'New body' }

  const error = caught(() => write(store, context, [rename, replace]))
  assert.equal(error.kind, 'revision_mismatch')
  assert.match(error.message, /^Operation #2 \(counting from 1\) failed, so no change was written:/)
  assert.equal(readFileSync(file, 'utf8'), before)
  const persisted = store.loadScopes(context).space.views('space').find(node => node.id === id)
  assert.equal(persisted?.revision, revision)

  const staged = /has staged revision ([0-9a-f]{8}) in this batch/.exec(error.message)?.[1]
  assert.ok(staged, error.message)
  assert.notEqual(staged, revision)
  assert.ok(error.message.includes(`Committed revision before the batch: ${persisted.revision}.`))
  assert.ok(error.message.includes('Submit dependent edits in separate calls'))

  // Supplying the right intermediate token still lets the batch commit in order.
  // 提供正确的中间令牌时，批次仍能按顺序提交。
  const committed = write(store, context, [rename, { ...replace, expectedRevision: staged }])
  assert.equal(committed.operations[0]?.revision, staged)
  const finalNode = store.loadScopes(context).space.views('space').find(node => node.id === id)
  assert.equal(finalNode?.path.at(-1), 'New title')
  assert.equal(finalNode?.body, 'New body')
  assert.equal(finalNode?.revision, committed.operations[1]?.revision)
})

// A staged move can leave the original revision in a different scope.
// 批内移动后，原修订可能留在不同的层。
test('a staged move finds the committed revision in its original scope', () => {
  const { store, context } = setup()
  const { id, revision } = write(store, context, [
    { action: 'create', scope: 'space', section: 'conventions', title: 'Before move', body: 'Text' },
  ]).operations[0]!
  const file = store.scopePath('space', undefined)
  const before = readFileSync(file, 'utf8')
  const error = caught(() => write(store, context, [
    { action: 'move', id, expectedRevision: revision, scope: 'project', section: 'pitfalls' },
    { action: 'rename', id, expectedRevision: revision, title: 'After move' },
    { action: 'replace', id, expectedRevision: revision, body: 'New text' },
  ]))

  assert.match(error.message, /^Operation #3 .* has staged revision [0-9a-f]{8} in this batch/)
  assert.ok(error.message.includes(`Committed revision before the batch: ${revision}.`))
  assert.equal(readFileSync(file, 'utf8'), before)
  assert.equal(store.registry().projectForHost('host-1'), undefined)
})

test('edits keep identity and change revision', () => {
  const { store, context } = setup()
  const created = write(store, context, [{ action: 'create', scope: 'user', section: 'communication', title: 'Language', body: 'Reply in Traditional Chinese.' }])
  const id = created.operations[0]!.id
  let revision = created.operations[0]!.revision
  for (const change of [
    { action: 'append', text: 'Keep status lines short.' },
    { action: 'rename', title: 'Language and tone' },
    { action: 'replace', body: 'Reply in English.' },
  ]) {
    const receipt = write(store, context, [{ ...change, id, expectedRevision: revision }])
    assert.equal(receipt.operations[0]?.id, id)
    assert.notEqual(receipt.operations[0]?.revision, revision)
    revision = receipt.operations[0]!.revision
  }
  const view = store.loadScopes(context).user.views('user').find(candidate => candidate.id === id)!
  assert.equal(view.path[view.path.length - 1], 'Language and tone')
  assert.equal(view.body, 'Reply in English.')
})

test('invalid titles and bodies are refused', () => {
  const { store, context } = setup()
  for (const value of [
    { action: 'create', scope: 'user', section: 'identity', title: 'A', body: '## Inner' },
    { action: 'create', scope: 'user', section: 'identity', title: 'A', body: '<!-- mem id=x -->' },
    { action: 'create', scope: 'user', section: 'identity', title: '# A' },
    { action: 'create', scope: 'user', section: 'identity', title: 'two\nlines' },
    { action: 'create', scope: 'user', section: 'missing', title: 'A' },
    { action: 'create', scope: 'user', section: 'identity', newSection: true, title: 'A' },
    { action: 'create', section: 'identity', title: 'A' },
  ]) {
    assert.throws(() => write(store, context, [value]), MemoryError, JSON.stringify(value))
  }
  assert.doesNotThrow(() => write(store, context, [{ action: 'create', scope: 'user', section: 'identity', title: 'Deep body', body: '##### Allowed body heading' }]))
})

test('delete guards the base section and children', () => {
  const { store, context } = setup()
  const parentId = write(store, context, [{ action: 'create', scope: 'space', section: 'references', title: 'Docs', body: 'Index of docs.' }]).operations[0]!.id
  write(store, context, [{ action: 'create', scope: 'space', parentId, title: 'Contracts', body: 'docs/contracts holds contracts.' }])
  const views = store.loadScopes(context).space.views('space')
  const base = views.find(view => view.section === BASE_SECTION_KEY)!
  const parent = views.find(view => view.id === parentId)!

  assert.throws(() => write(store, context, [{ action: 'delete', id: base.id, expectedRevision: base.revision, withChildren: true }]))
  assert.throws(() => write(store, context, [{ action: 'delete', id: parentId, expectedRevision: parent.revision }]))
  const receipt = write(store, context, [{ action: 'delete', id: parentId, expectedRevision: parent.revision, withChildren: true }])
  assert.equal(receipt.operations[0]?.deletedChildren, 1)
  assert.ok(store.loadScopes(context).space.views('space').every(view => view.id !== parentId))
})

test('a move across scopes relevels the subtree', () => {
  const { store, context } = setup()
  const parentId = write(store, context, [{ action: 'create', scope: 'space', section: 'environment', title: 'Toolchain', body: 'Rust and pnpm.' }]).operations[0]!.id
  const childId = write(store, context, [{ action: 'create', scope: 'space', parentId, title: 'Cargo jobs', body: 'build.jobs = 16' }]).operations[0]!.id
  const revision = store.loadScopes(context).space.views('space').find(view => view.id === parentId)!.revision
  const receipt = write(store, context, [{ action: 'move', id: parentId, expectedRevision: revision, scope: 'project', newSection: true }])
  assert.notEqual(receipt.createdProject, undefined)
  assert.ok(receipt.operations[0]?.newSection)
  const documents = store.loadScopes(context)
  assert.ok(documents.space.views('space').every(view => view.id !== parentId && view.id !== childId))
  const project = documents.project!.document.views('project')
  const moved = project.find(view => view.id === parentId)!
  const movedChild = project.find(view => view.id === childId)!
  assert.equal(moved.level, 1)
  assert.notEqual(moved.section, undefined)
  assert.equal(movedChild.level, 2)
})

test('a project write binds a new memory project', () => {
  const { store, context } = setup()
  const receipt = write(store, context, [{ action: 'create', scope: 'project', section: 'pitfalls', title: 'Linking', body: 'Linking dominates edit cycles.' }])
  const created = receipt.createdProject
  assert.notEqual(created, undefined)
  assert.equal(store.registry().projectForHost('host-1')?.id, created)
  const again = write(store, context, [{ action: 'create', scope: 'project', section: 'pitfalls', title: 'Hooks', body: 'Profile hook runs per user turn.' }])
  assert.equal(again.createdProject, undefined)

  const error = caught(() => write(store, {}, [{ action: 'create', scope: 'project', section: 'pitfalls', title: 'X' }]))
  assert.equal(error.kind, 'project_unavailable')
  assert.ok(error.message.startsWith('Operation #1 '))
})

test('AI writes to a project with memory off are refused', () => {
  const { store, context } = setup()
  const created = write(store, context, [{ action: 'create', scope: 'project', section: 'pitfalls', title: 'Linking', body: 'x' }]).createdProject!
  store.updateRegistry(registry => registry.setEnabled(created, false, '2026-10-20T00:00Z'))
  assert.equal(caught(() => write(store, context, [{ action: 'create', scope: 'project', section: 'pitfalls', title: 'Y' }])).kind, 'project_unavailable')
  assert.doesNotThrow(() => writeMemory(store, context, { session: undefined, source: 'user' }, DEFAULT_BUDGET, [parseWriteOperation({ action: 'create', scope: 'project', section: 'pitfalls', title: 'Y' })]))
})

test('similar titles are reported as duplicates', () => {
  const { store, context } = setup()
  write(store, context, [{ action: 'create', scope: 'space', section: 'conventions', title: 'Commit message style', body: 'Categorized.' }])
  const receipt = write(store, context, [{ action: 'create', scope: 'space', section: 'conventions', title: 'Commit message styles', body: 'Short subject.' }])
  assert.equal(receipt.operations[0]?.duplicates.length, 1)
  assert.ok(renderWriteReceipt(receipt).includes('possible duplicates'))
})

test('untouched bytes survive writes', () => {
  const { store, context } = setup()
  const file = store.scopePath('user', undefined)
  mkdirSync(path.dirname(file), { recursive: true })
  const hand = 'Intro paragraph.\r\n\r\n# Identity\r\n\r\nWritten   by *hand*.\r\n\r\n## Name   \r\n\r\nAda\r\n'
  writeFileSync(file, hand)
  const identity = store.loadScopes(context).user.views('user').find(view => view.level === 1)!
  write(store, context, [{ action: 'create', scope: 'user', parentId: identity.id, title: 'Timezone', body: 'UTC+8' }])
  const after = readFileSync(file, 'utf8')
  assert.ok(after.startsWith(hand))
  assert.ok(after.includes('## Timezone\r\n'))
  assert.ok(!after.replaceAll('\r\n', '').includes('\n'))
})
