import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { DEFAULT_SETTINGS } from '../settings.js'
import * as markdown from './index.js'

function access(): markdown.MarkdownMemoryAccess {
  const store = new markdown.MarkdownMemoryStore(mkdtempSync(path.join(tmpdir(), 'vulcan-memory-')))
  const resolved = markdown.resolveAccess(store, DEFAULT_SETTINGS, { hostProjectId: 'host-1', rootPath: path.join(tmpdir(), 'repo') })
  assert.ok(resolved)
  return resolved
}

const AUTHOR = { session: 'session-1', source: 'ai' } as const

test('tools write, find and inject a fact', () => {
  const memory = access()
  assert.equal(markdown.snapshot(memory), '')
  const receipt = markdown.write(memory, AUTHOR, {
    operations: [{ action: 'create', scope: 'project', section: 'base', title: 'Verify with targeted tests only', body: 'Full suite takes an hour.' }],
  })
  assert.match(receipt, /Verify with targeted tests only/)
  assert.match(markdown.search(memory, { patterns: ['targeted'] }), /Full suite takes an hour\./)
  assert.match(markdown.outline(memory, { scopes: ['project'] }), /Verify with targeted tests only/)
  assert.match(markdown.snapshot(memory), /Full suite takes an hour\./)
})

test('arguments are checked like serde with deny_unknown_fields', () => {
  const memory = access()
  assert.throws(() => markdown.search(memory, { pattern: ['x'] }), /Invalid arguments: unknown field `pattern`/)
  assert.throws(() => markdown.outline(memory, { depth: 'deep' }), /Invalid arguments: `depth`/)
  assert.throws(() => markdown.write(memory, AUTHOR, {}), /Invalid arguments: missing field `operations`/)
  assert.throws(() => markdown.write(memory, AUTHOR, { operations: [{ action: 'explode' }] }), /Invalid arguments: /)
  assert.deepEqual(markdown.parseOutlineRequest(undefined), {})
})

test('memory is inactive outside markdown mode or for a project with memory off', () => {
  const memory = access()
  assert.equal(markdown.resolveAccess(memory.store, { ...DEFAULT_SETTINGS, mode: 'off' }, memory.context), undefined)
  assert.equal(markdown.resolveAccess(memory.store, { ...DEFAULT_SETTINGS, mode: 'vmm' }, memory.context), undefined)

  markdown.write(memory, AUTHOR, { operations: [{ action: 'create', scope: 'project', section: 'base', title: 'Bind the project', body: 'x' }] })
  const projectId = memory.store.registry().projectForHost('host-1')?.id
  assert.ok(projectId)
  memory.store.updateRegistry(registry => registry.setEnabled(projectId, false, '2026-01-01T00:00:00Z'))
  assert.equal(markdown.resolveAccess(memory.store, DEFAULT_SETTINGS, memory.context), undefined)
})
