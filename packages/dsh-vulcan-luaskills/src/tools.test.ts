import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DIRECTORY_FIELD, invocationContext, modelSchema, SESSION_FIELD, toolName } from './tools.js'

test('tool names are lowercased, limited to word characters and 64 long, prefixed on collision', () => {
  assert.equal(toolName('vulcan-codekit-repo-map', () => false), 'vulcan_codekit_repo_map')
  assert.equal(toolName('Vulcan.Codekit RG', () => false), 'vulcan_codekit_rg')
  assert.equal(toolName('read', name => name === 'read'), 'ls_read')
  const long = toolName('x'.repeat(80), () => false)
  assert.equal(long.length, 64)
  assert.equal(toolName('x'.repeat(80), () => true).length, 64)
  for (const name of [long, toolName('a-b', () => true)]) assert.match(name, /^[a-z0-9_]{1,64}$/)
})

test('the model schema hides the Host-filled fields and reports which were declared', () => {
  const schema = {
    type: 'object',
    properties: { [SESSION_FIELD]: { type: 'string' }, [DIRECTORY_FIELD]: { type: 'string' }, path: { type: 'string' } },
    required: [SESSION_FIELD, 'path'],
    additionalProperties: false,
  }
  const { parameters, session, directory } = modelSchema(schema)
  assert.equal(session, true)
  assert.equal(directory, true)
  assert.deepEqual(parameters, { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false })
  // The entry's own schema is left as it was.
  assert.ok(SESSION_FIELD in schema.properties)
})

test('a schema without the fields, or none at all, still gives an object schema', () => {
  assert.deepEqual(modelSchema(undefined), { parameters: { type: 'object', properties: {} }, session: false, directory: false })
  const plain = modelSchema({ type: 'object', properties: { q: { type: 'string' } } })
  assert.equal(plain.session, false)
  assert.equal('required' in plain.parameters, false)
})

test('the invocation context names dsh and its version, with the session when known', () => {
  const context = invocationContext('vulcan_codekit_rg', 'session-1', '0.2.1-rc.2')
  assert.equal(context.request_context.client_name, 'dsh')
  assert.deepEqual(context.request_context.client_info, { kind: 'cli', name: 'dsh', version: '0.2.1-rc.2' })
  assert.equal(context.request_context.session_id, 'session-1')
  assert.equal(context.client_budget.tool_name, 'vulcan_codekit_rg')
  assert.equal('session_id' in invocationContext('x', undefined, '1').request_context, false)
})
