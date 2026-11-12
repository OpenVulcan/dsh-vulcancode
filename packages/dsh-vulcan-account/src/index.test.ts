import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { AccountError, OpenVulcanAccount, type Credential } from '@openvulcan/openvulcan-account'

import { CREDENTIAL_KEY, deviceInfo, DshCredentialStore, handle, ROUTES, type AccountView, type OpenVulcanAccountService } from './index.js'

/** dsh's credential service, reduced to one in-memory record per key. */
class Records {
  readonly values = new Map<string, CredentialRecord>()
  // Serialize mutation callbacks like the DSH document lock.
  // 像 DSH 文档锁一样串行执行修改回调。
  private queue = Promise.resolve()
  async readRecord(key: string) { return this.values.get(key) }
  async modifyRecord(key: string, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
    const operation = this.queue.then(async () => {
      const next = await mutate(this.values.get(key))
      if (next !== undefined) this.values.set(key, next)
      return next ?? this.values.get(key)
    })
    this.queue = operation.then(() => {}, () => {})
    return operation
  }
  async deleteRecord(key: string) { await this.queue; this.values.delete(key) }
}

const CREDENTIAL: Credential = {
  site: 'global', auth_origin: 'https://auth.example', access_token: 'a'.repeat(43), authorization_id: 'auth-1', expires_at: '2099-01-01T00:00:00Z',
}

async function call(service: Partial<OpenVulcanAccountService>, method: 'GET' | 'POST', name: string, query = '') {
  const entry = ROUTES.find(([m, n]) => m === method && n === name)
  assert.ok(entry, `${method} ${name} is a route`)
  const response = await handle(service as OpenVulcanAccountService, entry[2], new Request(`http://127.0.0.1/api/vulcan-account/${name}${query}`, { method }))
  return { status: response.status, answer: await response.json() as { ok: boolean; value?: unknown; error?: { code: string } } }
}

test('keeps the credential as one grant record under the shared key', async () => {
  const records = new Records()
  const store = new DshCredentialStore({ credentials: records } as unknown as Context)
  await store.write(CREDENTIAL)
  assert.equal(CREDENTIAL_KEY, 'openvulcan/account')
  assert.equal(records.values.get(CREDENTIAL_KEY)?.kind, 'grant')
  assert.deepEqual(await store.read(), CREDENTIAL)
  // Replace only the exact version still held by the locked credential store.
  // 仅替换加锁凭据存储仍持有的准确版本。
  const pending = { ...CREDENTIAL, rotation_pending: true }
  assert.equal(await store.replace(CREDENTIAL, pending), true)
  assert.equal(await store.replace(CREDENTIAL, { ...CREDENTIAL, access_token: 'b'.repeat(43) }), false)
  assert.deepEqual(await store.read(), pending)
  assert.equal(await store.take(CREDENTIAL), undefined)
  assert.deepEqual(await store.take(pending), pending)
  assert.deepEqual(records.values.get(CREDENTIAL_KEY), { kind: 'grant', payload: null })
  assert.equal(await store.replace(pending, CREDENTIAL), false)
  assert.equal(await store.read(), undefined)
  await store.write(CREDENTIAL)
  assert.deepEqual(await store.read(), CREDENTIAL)
})

test('two DSH instances revoke the rotated token in either commit order', async context => {
  for (const rotationFirst of [true, false]) {
    await context.test(rotationFirst ? 'refresh publishes first' : 'sign-out clears first', async t => {
      const records = new Records()
      const rotating = new DshCredentialStore({ credentials: records } as unknown as Context)
      const exiting = new DshCredentialStore({ credentials: records } as unknown as Context)
      const current = { ...CREDENTIAL, expires_at: new Date(Date.now() + 3_600_000).toISOString() }
      const renewed = { ...CREDENTIAL, access_token: 'b'.repeat(43) }
      await rotating.write(current)
      const requestStarted = Promise.withResolvers<void>()
      const reply = Promise.withResolvers<Response>()
      const clearStarted = Promise.withResolvers<void>()
      const allowClear = Promise.withResolvers<void>()
      const take = exiting.take.bind(exiting)
      const storeRead = exiting.read.bind(exiting)
      const pauseClear = async () => { clearStarted.resolve(); await allowClear.promise }
      // Expose the former read/delete gap without changing the order of atomic mutations.
      // 暴露原先读取与删除之间的窗口，同时保留原子修改的顺序。
      t.mock.method(exiting, 'read', async () => {
        const saved = await storeRead()
        await pauseClear()
        return saved
      })
      t.mock.method(exiting, 'take', async () => { await pauseClear(); return take() })
      const revoked: (string | null)[] = []
      t.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit) => {
        if (url.endsWith('/token/refresh')) {
          requestStarted.resolve()
          return reply.promise
        }
        assert.match(url, /\/logout$/)
        const authorization = new Headers(request.headers).get('Authorization')
        revoked.push(authorization)
        return new Response(null, { status: authorization === `Auth ${renewed.access_token}` ? 204 : 401 })
      })
      const refresh = new OpenVulcanAccount(rotating, deviceInfo('test')).credential()
      await requestStarted.promise
      const logout = new OpenVulcanAccount(exiting, deviceInfo('test')).signOut()
      await clearStarted.promise
      if (rotationFirst) {
        reply.resolve(Response.json({ ...renewed, token_type: 'Auth' }))
        assert.deepEqual(await refresh, renewed)
        allowClear.resolve()
        await logout
      } else {
        allowClear.resolve()
        await logout
        reply.resolve(Response.json({ ...renewed, token_type: 'Auth' }))
        await assert.rejects(refresh, /changed during refresh/)
      }
      assert.equal(await rotating.read(), undefined)
      assert.deepEqual(revoked, rotationFirst
        ? [`Auth ${renewed.access_token}`] : [`Auth ${current.access_token}`, `Auth ${renewed.access_token}`])
    })
  }
})

test('routes check the site and report failures with their code', async () => {
  let started: string | undefined
  const service: Partial<OpenVulcanAccountService> = {
    signIn: async (site) => {
      started = site
      return { approvalUrl: 'https://auth.example/approve', expiresAt: '2099-01-01T00:00:00Z', done: new Promise(() => {}), cancel: () => {} }
    },
    signOut: async () => { throw new AccountError('nobody is signed in') },
    view: async (): Promise<AccountView> => ({ account: { signedIn: false }, signIn: null }),
  }
  const bad = await call(service, 'POST', 'signin', '?site=mars')
  assert.deepEqual([bad.status, bad.answer.error?.code, started], [400, 'invalid_request', undefined])
  const good = await call(service, 'POST', 'signin', '?site=cn')
  assert.deepEqual([good.answer.value, started], [{ approvalUrl: 'https://auth.example/approve' }, 'cn'])
  const out = await call(service, 'POST', 'signout')
  assert.deepEqual([out.status, out.answer.error?.code], [401, 'not_signed_in'])
  assert.deepEqual((await call(service, 'GET', 'state')).answer.value, { account: { signedIn: false }, signIn: null })
})

test('the rotated token is revoked even if its DSH provider is disposed before it can be saved', async t => {
  const records = new Records()
  const rotating = new DshCredentialStore({ credentials: records } as unknown as Context)
  const exiting = new DshCredentialStore({ credentials: records } as unknown as Context)
  const current = { ...CREDENTIAL, expires_at: new Date(Date.now() + 3_600_000).toISOString() }
  const renewed = { ...CREDENTIAL, access_token: 'b'.repeat(43) }
  const started = Promise.withResolvers<void>()
  const reply = Promise.withResolvers<Response>()
  const revoked: (string | null)[] = []
  await rotating.write(current)
  t.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit) => {
    if (url.endsWith('/token/refresh')) {
      started.resolve()
      return reply.promise
    }
    assert.match(url, /\/logout$/)
    const authorization = new Headers(request.headers).get('Authorization')
    revoked.push(authorization)
    return new Response(null, { status: authorization === `Auth ${renewed.access_token}` ? 204 : 401 })
  })
  const rotation = new OpenVulcanAccount(rotating, deviceInfo('test')).credential()
  await started.promise
  await new OpenVulcanAccount(exiting, deviceInfo('test')).signOut()
  t.mock.method(rotating, 'replace', async () => { throw new Error('DSH credential provider was disposed') })
  reply.resolve(Response.json({ ...renewed, token_type: 'Auth' }))
  await assert.rejects(rotation, /provider was disposed/)
  assert.equal(await exiting.read(), undefined)
  assert.deepEqual(revoked, [`Auth ${current.access_token}`, `Auth ${renewed.access_token}`])
})

test('names the sign-in client dsh at its exact version', () => {
  assert.deepEqual(deviceInfo('0.2.1-rc.2'), { display_name: 'dsh', client_version: '0.2.1-rc.2' })
})
