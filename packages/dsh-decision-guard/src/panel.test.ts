import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

import { DecisionEngine, DecisionHome, DEFAULT_OPTIONS, OpenVulcanAccount, type AccountSource, type Credential, type CredentialStore, type EngineSettings } from '@openvulcan/vulcan-decision'

import { startMockOpenVulcan } from '../../vulcan-decision/lib/cloud/mock-openvulcan.test.helper.js'
import { handle, Panel, ROUTES, ServiceAccount } from './panel.js'
import { RecordStore } from './records.js'

class MemoryStore implements CredentialStore {
  value: Credential | undefined
  async read() { return this.value }
  async write(credential: Credential) { this.value = credential }
  async delete() { this.value = undefined }
}

const mock = await startMockOpenVulcan({ site: 'global' })
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vulcan-decision-panel-'))
after(async () => {
  await mock.close()
  fs.rmSync(root, { recursive: true, force: true })
})

// Stands in for the account plugin's service; `running` switches the plugin on and off.
const signedIn = new OpenVulcanAccount(new MemoryStore(), { display_name: 'test', client_version: 'test 0' }, mock.origin)
let running = true
const account = new ServiceAccount(() => (running ? signedIn as AccountSource : undefined))
const engine = new DecisionEngine({ home: new DecisionHome(root), account })
// An empty model uses the first one OpenVulcan lists, as a fresh install does.
const settings: EngineSettings = { backend: 'cloud', cloudModel: '', options: DEFAULT_OPTIONS }
const log = new RecordStore(engine.home)
const panel = new Panel(engine, { engine: () => settings, downloadSource: () => 'official', accountPlugin: () => account.available() }, log)

async function route(method: 'GET' | 'POST', name: string, query = '', body?: unknown): Promise<{ status: number; answer: { ok: boolean; value?: unknown; error?: { code: string } } }> {
  const entry = ROUTES.find(([m, n]) => m === method && n === name)
  assert.ok(entry, `${method} ${name} is a route`)
  const request = new Request(`http://127.0.0.1/api/vulcan-decision/${name}${query}`, {
    method,
    ...body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } },
  })
  const response = await handle(panel, entry[2], request)
  return { status: response.status, answer: await response.json() as never }
}

test('the panel shows the account the account plugin signed in, without the token', async () => {
  const pending = await signedIn.signIn('global')
  await mock.approve(pending.approvalUrl)
  await pending.done
  const { answer: state } = await route('GET', 'state')
  const value = state.value as { account: { signedIn: boolean; plugin: boolean }; packs: { id: string }[] }
  assert.deepEqual([value.account.signedIn, value.account.plugin], [true, true])
  assert.deepEqual(value.packs.map(pack => pack.id), ['onnx-cpu', 'onnx-cuda', 'torch-cpu', 'torch-cu128'])
  assert.equal(JSON.stringify(state).includes((await signedIn.credential()).access_token), false)
  assert.equal(ROUTES.some(([, name]) => name.startsWith('signin') || name === 'signout'), false)
})

test('measures endpoints and judges a sample call with the saved settings', async () => {
  assert.deepEqual((await route('GET', 'cloud/models')).answer.value, [mock.model])
  const probe = await route('POST', 'cloud/probe')
  const snapshot = probe.answer.value as { modelId: string; selectedEndpointId: string; endpoints: { endpointId: string }[] }
  assert.equal(snapshot.modelId, mock.model)
  assert.equal(snapshot.selectedEndpointId, 'edge-a')
  assert.equal((await route('POST', 'cloud/check-lock', '', { endpoint: 'edge-a' })).answer.ok, true)
  assert.equal((await route('POST', 'cloud/check-lock', '', { endpoint: 'nope' })).status, 400)
  const tested = await route('POST', 'cloud/test', '', { endpoint: 'edge-a', input: { kind: 'preset', preset: 'database_reset' } })
  assert.equal((tested.answer.value as { succeeded: number }).succeeded, 5)
  const { answer } = await route('POST', 'test', '', { tool: 'shell_command', args: { command: 'psql -c "DROP DATABASE production"' } })
  assert.equal(answer.ok, true)
  assert.deepEqual({ ...(answer.value as object), elapsed_ms: 0 }, {
    decision: 'review', logits: [1, 0, -1], input_tokens: 12, model_evaluated: true,
    backend: 'cloud', model: mock.model, via: 'edge-a', elapsed_ms: 0,
  })
})

test('requests are checked and failures carry a code', async () => {
  assert.equal((await route('POST', 'packs/install', '?pack=nope')).status, 400)
  assert.equal((await route('POST', 'models/install-dir', '', { dir: '' })).answer.error?.code, 'invalid_request')
})

test('without the account plugin cloud judging fails as not signed in', async () => {
  running = false
  try {
    const { status, answer } = await route('POST', 'test', '', { tool: 'shell_command', args: { command: 'ls' } })
    assert.equal(status, 401)
    assert.equal(answer.error?.code, 'not_signed_in')
    const value = (await route('GET', 'state')).answer.value as { account: { signedIn: boolean; plugin: boolean } }
    assert.deepEqual([value.account.signedIn, value.account.plugin], [false, false])
  } finally {
    running = true
  }
})

test('after signing out cloud judging fails as not signed in', async () => {
  await signedIn.signOut()
  engine.cloud.reset()
  const { status, answer } = await route('POST', 'test', '', { tool: 'shell_command', args: { command: 'ls' } })
  assert.equal(status, 401)
  assert.equal(answer.error?.code, 'not_signed_in')
  assert.deepEqual((await route('GET', 'cloud/endpoints')).answer.value, { mode: 'auto', endpoints: [] })
})

test('decision log routes page, mark, export and clear, and reject unknown records and filters', async () => {
  const kept = log.append({
    judgedAtMs: Date.now(), sessionId: 's1', toolName: 'bash', arguments: '{"command":"ls"}', attended: true,
    judge: { label: 'review', elapsedMs: 1, trace: { backend: 'cloud', model: 'm', policyVersion: 'v', settings: DEFAULT_OPTIONS, rendered: 'Tool: bash' } },
    outcome: 'user_allowed',
  })
  const page = await route('GET', 'records', '?label=review&limit=10')
  assert.equal((page.answer.value as { records: unknown[] }).records.length, 1)
  assert.equal((await route('GET', 'records', '?label=maybe')).status, 400)
  assert.equal((await route('GET', 'records', '?before=nope')).status, 400)
  assert.equal((await route('POST', 'records/mark', '', { id: kept.id, correction: 'maybe' })).status, 400)
  assert.equal((await route('POST', 'records/mark', '', { id: 'nope', correction: 'allow' })).status, 400)
  assert.equal((await route('POST', 'records/mark', '', { id: kept.id, correction: 'allow' })).status, 200)
  assert.equal(((await route('POST', 'records/export')).answer.value as { count: number }).count, 1)
  await route('POST', 'records/clear')
  assert.equal(((await route('GET', 'records')).answer.value as { total: number }).total, 0)
})
