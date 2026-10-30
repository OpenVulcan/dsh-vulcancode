// Translated from VulcanCode `crates/vulcan-markdown-memory/src/package/tests.rs`.

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { DEFAULT_BUDGET } from '../settings.js'
import { EXPORT_FORMAT_VERSION } from './constants.js'
import type { NodeView } from './document.js'
import { MemoryError } from './errors.js'
import { parseWriteOperation, writeMemory } from './operations.js'
import { applyImport, exportPackage, previewImport, writeArchive, type ProjectMapping, type ProjectTarget } from './package.js'
import type { MemoryScope } from './scope.js'
import { MarkdownMemoryStore, type ProjectContext } from './store.js'

function store(): MarkdownMemoryStore {
  return new MarkdownMemoryStore(mkdtempSync(path.join(tmpdir(), 'vulcan-memory-')))
}

function context(host: string, root: string): ProjectContext {
  return { hostProjectId: host, rootPath: root }
}

function write(target: MarkdownMemoryStore, project: ProjectContext, operations: unknown[]): void {
  writeMemory(target, project, { session: undefined, source: 'user' }, DEFAULT_BUDGET, operations.map(parseWriteOperation))
}

function view(target: MarkdownMemoryStore, scope: MemoryScope, project: string | undefined, titles: readonly string[]): NodeView {
  const found = target.load(scope, project).views(scope).find(item => JSON.stringify(item.path) === JSON.stringify(titles))
  assert.ok(found, `no node at ${titles.join(' > ')}`)
  return found
}

/** Seed a user note, a space note and one project note; returns the memory project id. */
function seed(target: MarkdownMemoryStore): string {
  write(target, context('host-a', '/work/alpha'), [
    { action: 'create', scope: 'user', section: 'identity', title: 'Name', body: 'Ada' },
    { action: 'create', scope: 'space', section: 'base', title: 'Shell', body: 'PowerShell' },
    { action: 'create', scope: 'project', section: 'pitfalls', title: 'Line endings', body: 'CRLF' },
  ])
  const id = target.registry().projects[0]?.id
  assert.ok(id)
  return id
}

function exportAll(target: MarkdownMemoryStore, project: string): Uint8Array {
  return exportPackage(target, { user: true, space: true, memoryProjectIds: [project] }).bytes
}

function mapping(packageProjectId: string, target: ProjectTarget): ProjectMapping {
  return { packageProjectId, target }
}

function rejects(run: () => unknown): MemoryError {
  try {
    run()
  } catch (error) {
    if (error instanceof MemoryError) return error
    throw error
  }
  assert.fail('expected a MemoryError')
}

test('importing into the source store is a no-op', () => {
  const target = store()
  const project = seed(target)
  const archive = exportAll(target, project)
  const mappings = [mapping(project, { action: 'link', memoryProjectId: project })]
  const preview = previewImport(target, archive, 'a.zip', mappings)
  assert.equal(preview.scopes.length, 3)
  for (const scope of preview.scopes) {
    assert.ok(scope.added.length === 0 && scope.conflicts.length === 0, JSON.stringify(scope))
    assert.ok(scope.same > 0)
  }
  const report = applyImport(target, archive, 'a.zip', preview.sha256, mappings, [])
  assert.deepEqual([report.added, report.replaced], [0, 0])
  assert.equal(report.backupDirectory, null)
})

test('a fresh store receives everything once', () => {
  const source = store()
  const project = seed(source)
  const archive = exportAll(source, project)

  const target = store()
  // The target already has its own preset sections with other ids.
  write(target, context('host-b', '/elsewhere/beta'), [{ action: 'create', scope: 'user', section: 'expertise', title: 'Rust', body: 'Daily' }])
  const preview = previewImport(target, archive, 'a.zip', [])
  assert.equal(preview.projects.length, 1)
  assert.equal(preview.projects[0]?.candidates.length, 0)
  const user = preview.scopes[0]
  assert.equal(user?.scope, 'user')
  assert.deepEqual(user?.newSections, [], 'preset sections match by key')
  assert.equal(user?.added.length, 1)
  rejects(() => applyImport(target, archive, 'a.zip', preview.sha256, [], []))

  const report = applyImport(target, archive, 'a.zip', preview.sha256, [mapping(project, { action: 'create' })], [])
  assert.equal(report.createdProjects.length, 1)
  assert.notEqual(report.backupDirectory, null, 'the user file existed')
  const created = report.createdProjects[0]
  assert.equal(view(target, 'project', created, ['Pitfalls', 'Line endings']).body, 'CRLF')
  assert.equal(view(target, 'user', undefined, ['Identity', 'Name']).body, 'Ada')
  assert.equal(target.load('user', undefined).roots.filter(root => root.title === 'Identity').length, 1)
  assert.deepEqual(target.registry().project(created ?? '')?.hostProjectIds, [])

  const again = previewImport(target, archive, 'a.zip', [mapping(project, { action: 'link', memoryProjectId: created ?? '' })])
  for (const scope of again.scopes) {
    assert.ok(scope.added.length === 0 && scope.conflicts.length === 0, `a repeated import is identical: ${JSON.stringify(scope)}`)
  }
})

test('conflicts need a resolution', () => {
  const target = store()
  const project = seed(target)
  const archive = exportAll(target, project)
  const name = view(target, 'user', undefined, ['Identity', 'Name'])
  write(target, context('host-a', '/work/alpha'), [{ action: 'replace', id: name.id, expectedRevision: name.revision, body: 'Grace' }])
  const mappings = [mapping(project, { action: 'ignore' })]
  const preview = previewImport(target, archive, 'a.zip', mappings)
  assert.equal(preview.scopes.length, 2, 'an ignored project is not merged')
  const conflict = preview.scopes[0]?.conflicts[0]
  assert.ok(conflict)
  assert.deepEqual([conflict.local.body, conflict.imported.body], ['Grace', 'Ada'])

  rejects(() => applyImport(target, archive, 'a.zip', preview.sha256, mappings, []))
  const take = { scope: 'user', nodeId: conflict.id, choice: 'take_imported' } as const
  const unknown = { scope: 'space', nodeId: 'm-missing', choice: 'keep_local' } as const
  rejects(() => applyImport(target, archive, 'a.zip', preview.sha256, mappings, [take, unknown]))
  rejects(() => applyImport(target, archive, 'a.zip', '0'.repeat(64), mappings, [take]))
  const report = applyImport(target, archive, 'a.zip', preview.sha256, mappings, [take])
  assert.equal(report.replaced, 1)
  assert.equal(view(target, 'user', undefined, ['Identity', 'Name']).body, 'Ada')
  assert.ok(report.backupDirectory)
  assert.match(readFileSync(path.join(report.backupDirectory, 'user.md'), 'utf8'), /Grace/)
})

test('keeping both adds a copy', () => {
  const target = store()
  const project = seed(target)
  const archive = exportAll(target, project)
  const shell = view(target, 'space', undefined, ['Base', 'Shell'])
  write(target, context('host-a', '/work/alpha'), [{ action: 'replace', id: shell.id, expectedRevision: shell.revision, body: 'Bash' }])
  const mappings = [mapping(project, { action: 'ignore' })]
  const preview = previewImport(target, archive, 'a.zip', mappings)
  const report = applyImport(target, archive, 'a.zip', preview.sha256, mappings, [{ scope: 'space', nodeId: shell.id, choice: 'keep_both' }])
  assert.equal(report.added, 1)
  const shells = target.load('space', undefined).views('space').filter(item => JSON.stringify(item.path) === '["Base","Shell"]')
  assert.equal(shells.length, 2)
  assert.ok(shells.some(item => item.id === shell.id && item.body === 'Bash'))
  assert.ok(shells.some(item => item.id !== shell.id && item.body === 'PowerShell'))
})

test('duplicates are kept and projects are suggested', () => {
  const source = store()
  const project = seed(source)
  const archive = exportAll(source, project)
  const target = store()
  write(target, context('host-z', '/work/alpha'), [
    { action: 'create', scope: 'user', section: 'identity', title: 'Name', body: 'Someone' },
    { action: 'create', scope: 'project', section: 'base', title: 'Build', body: 'make' },
  ])
  const preview = previewImport(target, archive, 'a.zip', [])
  assert.equal(preview.scopes[0]?.duplicates.length, 1)
  assert.ok(preview.projects[0]?.candidates[0]?.reasons.includes('same_path'))
})

test('foreign packages are refused', () => {
  const target = store()
  const manifest = (version: number) => JSON.stringify({
    format: 'vulcan-markdown-memory', version, exportedAt: '2026-10-20T10:00Z', user: true, space: false, projects: [],
  })
  const valid = writeArchive(manifest(EXPORT_FORMAT_VERSION), [['user.md', '# Identity\n']])
  previewImport(target, valid, 'valid.zip', [])
  const newer = writeArchive(manifest(EXPORT_FORMAT_VERSION + 1), [['user.md', '']])
  assert.equal(rejects(() => previewImport(target, newer, 'newer.zip', [])).kind, 'unsupported_format')
  rejects(() => previewImport(target, writeArchive(manifest(EXPORT_FORMAT_VERSION), [['user.md', ''], ['notes.txt', '']]), 'extra.zip', []))
  rejects(() => previewImport(target, writeArchive(manifest(EXPORT_FORMAT_VERSION), []), 'missing.zip', []))
  rejects(() => previewImport(target, writeArchive(manifest(EXPORT_FORMAT_VERSION), [['user.md', ''], ['../escape.md', '']]), 'escape.zip', []))
  rejects(() => previewImport(target, new TextEncoder().encode('not a zip'), 'text.zip', []))
})
