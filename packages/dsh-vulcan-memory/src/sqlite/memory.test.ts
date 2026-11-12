import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { Credential } from '@openvulcan/openvulcan-account'
import { SqliteStore } from './store.js'
import { StructuredMemory } from './service.js'

// Distinct host project IDs exercise the same scoping rules used in dsh.
// 使用两个不同的主机项目标识验证 dsh 中的访问范围规则。
const projectA = 'dshproject-000000000000000a'
const projectB = 'dshproject-000000000000000b'

test('Jieba search and SQLite edits share a project-scoped revision boundary', async () => {
  // Reopen the database to verify both the persisted row and its full-text index.
  // 重新打开数据库，同时验证持久化记录和全文索引。
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-sqlite-test-'))
  let store = await SqliteStore.open(root)
  try {
    const original = store.write(projectA, { action: 'add', kind: 'memory', scope: 'project', title: '项目资料', body: '上海交通大学' })
    assert.ok(original)
    assert.equal(store.search(projectA, '交通大学', 10)[0]?.id, original.id)
    assert.deepEqual(store.search(projectB, '交通大学', 10), [])
    assert.throws(() => store.write(projectB, { action: 'remove', id: original.id, revision: original.revision }), /scope/)
    const updated = store.write(projectA, { action: 'edit', id: original.id, revision: original.revision, title: '发布', body: '发布前校验签名' })
    assert.ok(updated)
    assert.throws(() => store.write(projectA, { action: 'remove', id: original.id, revision: original.revision }), /changed/)
    store.close()
    store = await SqliteStore.open(root)
    assert.deepEqual(store.search(projectA, '交通大学', 10), [])
    assert.equal(store.search(projectA, '校验', 10)[0]?.revision, updated.revision)
    store.write(projectA, { action: 'remove', id: updated.id, revision: updated.revision })
    assert.deepEqual(store.search(projectA, '校验', 10), [])
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('free profile drafts require approval for the exact default offer and never write records', async (t) => {
  // Use a test account and a mocked regional endpoint; no live credentials or profile text are used.
  // 使用测试账号及模拟的区域接口，不使用真实凭据或画像内容。
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-sqlite-consent-'))
  let credential: Credential = {
    site: 'cn', auth_origin: 'https://auth.openvulcan.cn', authorization_id: 'fixture-one',
    access_token: 'fixture-token', expires_at: '2100-01-01T00:00:00Z',
  }
  const account = {
    status: async () => ({ signedIn: true }), credential: async () => credential,
  }
  const service = new StructuredMemory(root, () => true, () => account)
  let posts = 0
  // Simulate a new device authorization arriving while a request is in flight.
  // 模拟请求期间设备授权发生切换。
  let switchDuringRequest = false
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    assert.ok(input.startsWith('https://auth.openvulcan.cn/api/v1/vulcancode/memory-inference/'))
    assert.equal(new Headers(init.headers).get('Authorization'), 'Auth fixture-token')
    if (input.endsWith('/capabilities')) {
      const shared = { consent_revision: 'a'.repeat(64), embedding_dimension: 2, providers: ['inference', 'embedding'].map(capability => ({
        capability, model: 'test', provider: 'test', region: 'test', data_policy: 'test', privacy_url: 'https://example.org/',
      })) }
      return Response.json({ contract_version: 1, default_id: 'free-default', models: [
        { ...shared, id: 'another', name: 'Another' }, { ...shared, id: 'free-default', name: 'Free default' },
      ] })
    }
    ++posts
    assert.equal(typeof init.body, 'string')
    const request = JSON.parse(String(init.body))
    assert.equal(request.model_id, 'free-default')
    assert.equal(request.purpose, 'profile_instruction')
    assert.equal(request.input.instruction, 'Prefer concise notes. [redacted]')
    if (switchDuringRequest) credential = { ...credential, authorization_id: 'fixture-two' }
    return Response.json({ result: { accepted_nodes: [{ normalized_content: 'Prefer concise notes.' }] } })
  })
  try {
    await assert.rejects(service.draft('user', 'Prefer concise notes.'), /Approve/)
    const { offer } = await service.status()
    assert.ok(offer)
    await service.consent(offer.consent)
    assert.deepEqual(await service.draft('user', 'Prefer concise notes. api_key=fixture-secret'), ['Prefer concise notes.'])
    const store = await service.local()
    assert.deepEqual(store.list('', 'profile', 10), [])
    switchDuringRequest = true
    await assert.rejects(service.draft('user', 'Prefer concise notes. api_key=fixture-secret'), /account changed/)
    await assert.rejects(service.draft('user', 'test'), /approve/)
    await service.consent(null)
    await assert.rejects(service.draft('user', 'test'), /Approve/)
    assert.equal(posts, 2)
  } finally {
    service.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
