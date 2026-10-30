// Translated from VulcanCode `crates/vulcan-service-kernel/src/markdown_memory_services.rs` tests.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { MemoryError } from './markdown/errors.js'
import { MarkdownMemoryStore } from './markdown/store.js'
import { applyProjectAction, hostProjectOf, loadOverview, parseProjectAction, parseSettingsSave, resolveHost, writeAsUser, type HostProject } from './page.js'

function setup(): { root: string; store: MarkdownMemoryStore } {
  const root = mkdtempSync(path.join(tmpdir(), 'vulcan-memory-page-'))
  return { root, store: new MarkdownMemoryStore(path.join(root, 'memory')) }
}

function existingHost(root: string): HostProject {
  return { id: 'host-1', path: root, title: 'root' }
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

test('user project write binds and shows the project', () => {
  const { root, store } = setup()
  const host = existingHost(root)
  const overview = writeAsUser(store, [host], host, undefined, [
    { action: 'create', scope: 'project', section: 'base', title: 'Build with make', body: 'Use make.ps1.' },
  ])
  const bound = overview.boundMemoryProjectId
  assert.ok(bound)
  assert.equal(overview.memoryProjectId, bound)
  assert.ok(overview.project.some(node => node.body === 'Use make.ps1.' && node.source === 'user'))
  assert.ok(overview.projects.some(project => project.id === bound && !project.orphaned))
})

test('user writes reach a disabled project', () => {
  const { root, store } = setup()
  const host = existingHost(root)
  applyProjectAction(store, host, { action: 'create', projectId: host.id })
  const id = store.registry().projectForHost(host.id)?.id
  assert.ok(id)
  applyProjectAction(store, undefined, { action: 'set_enabled', memoryProjectId: id, enabled: false })
  const overview = writeAsUser(store, [host], host, undefined, [
    { action: 'create', scope: 'project', section: 'base', title: 'Keep notes', body: 'Still editable.' },
  ])
  assert.ok(overview.project.some(node => node.body === 'Still editable.'))
})

test('orphans are suggested and shown on request', () => {
  const { root, store } = setup()
  const oldHost: HostProject = { id: 'old-host', path: path.join(root, 'gone', 'vulcan-code'), title: 'vulcan-code' }
  applyProjectAction(store, oldHost, { action: 'create', projectId: oldHost.id })
  const orphan = store.registry().projects[0]?.id
  assert.ok(orphan)
  const current = path.join(root, 'vulcan-code')
  mkdirSync(current, { recursive: true })
  const host: HostProject = { id: 'new-host', path: current, title: 'vulcan-code' }
  const overview = loadOverview(store, [host], host, undefined)
  assert.equal(overview.boundMemoryProjectId, null)
  const candidate = overview.orphanCandidates.find(item => item.memoryProjectId === orphan)
  assert.ok(candidate?.reasons.includes('same_directory_name'))
  assert.ok(overview.projects.some(project => project.id === orphan && project.orphaned))

  assert.equal(loadOverview(store, [host], host, orphan).memoryProjectId, orphan)

  applyProjectAction(store, host, { action: 'link', projectId: host.id, memoryProjectId: orphan })
  const linked = loadOverview(store, [host], host, undefined)
  assert.equal(linked.boundMemoryProjectId, orphan)
  assert.deepEqual(linked.orphanCandidates, [])
})

test('unknown explicit memory project is refused', () => {
  const { store } = setup()
  assert.equal(rejects(() => loadOverview(store, [], undefined, 'p-missing')).kind, 'project_unavailable')
})

// dsh-specific request handling.

test('host projects come from workspaces and unknown ids are refused', () => {
  const { root } = setup()
  const host = hostProjectOf({ path: `${root}${path.sep}`, title: 'Repo' })
  assert.equal(host.path, root)
  assert.match(host.id, /^dshproject-[0-9a-f]{16}$/)
  assert.equal(resolveHost([host], host.id), host)
  assert.equal(resolveHost([host], undefined), undefined)
  rejects(() => resolveHost([host], 'dshproject-0000000000000000'))
})

test('page requests refuse unknown fields and invalid settings', () => {
  assert.deepEqual(parseProjectAction({ action: 'set_enabled', memoryProjectId: 'p-1', enabled: false }), { action: 'set_enabled', memoryProjectId: 'p-1', enabled: false })
  rejects(() => parseProjectAction({ action: 'create', projectId: 'h', extra: 1 }))
  rejects(() => parseProjectAction({ action: 'drop', projectId: 'h' }))
  rejects(() => parseSettingsSave({ mode: 'markdown', budget: { user: 1 } }))
  rejects(() => parseSettingsSave({ mode: 'other', budget: { user: 1, spaceBase: 1, projectBase: 1, spaceCatalog: 1, projectCatalog: 1 } }))
  assert.equal(parseSettingsSave({ mode: 'off', budget: { user: 1, spaceBase: 1, projectBase: 1, spaceCatalog: 1, projectCatalog: 1 } }).mode, 'off')
})
