// Translated from the tests in VulcanCode `crates/vulcan-markdown-memory/src/registry.rs`.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MemoryRegistry } from './registry.js'

test('linking moves a host binding, records paths and clears dismissal', () => {
  const registry = new MemoryRegistry()
  const old = registry.createForHost('host-old', 'D:/work/app', 'abc', 't1')
  const other = registry.createForHost('host-x', 'D:/work/other', undefined, 't1')
  const exists = (path: string) => path === 'D:/work/other'

  const candidates = registry.orphanCandidates('host-new', 'E:/moved/app', 'abc', exists)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]?.project.id, old)
  assert.deepEqual(candidates[0]?.reasons, ['same_directory_name', 'same_first_commit'])

  registry.ignoreHost('host-new')
  assert.deepEqual(registry.orphanCandidates('host-new', 'E:/moved/app', undefined, exists), [])

  registry.link(old, 'host-new', 'E:/moved/app', 't2')
  assert.equal(registry.projectForHost('host-new')?.id, old)
  assert.deepEqual(registry.ignoredHostProjectIds, [])
  registry.link(other, 'host-new', 'E:/moved/app', 't3')
  assert.deepEqual(registry.project(old)?.hostProjectIds, ['host-old'])

  const reloaded = MemoryRegistry.parse(registry.toJson(), 'registry.json')
  assert.deepEqual(reloaded, registry)
})

test('only format version 1 is read', () => {
  assert.throws(() => MemoryRegistry.parse('{"version":2,"projects":[],"ignoredHostProjectIds":[]}', 'r.json'), { kind: 'unsupported_format' })
  assert.throws(() => MemoryRegistry.parse('not json', 'r.json'), { kind: 'json' })
})
