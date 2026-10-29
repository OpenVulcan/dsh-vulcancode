import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { AccountError, type Credential } from '@openvulcan/openvulcan-account'

import { CREDENTIAL_KEY, deviceInfo, DshCredentialStore, handle, ROUTES, type AccountView, type OpenVulcanAccountService } from './index.js'

/** dsh's credential service, reduced to one in-memory record per key. */
class Records {
  readonly values = new Map<string, CredentialRecord>()
  async readRecord(key: string) { return this.values.get(key) }
  async modifyRecord(key: string, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
    const next = await mutate(this.values.get(key))
    if (next !== undefined) this.values.set(key, next)
    return next ?? this.values.get(key)
  }
  async deleteRecord(key: string) { this.values.delete(key) }
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
  await store.delete()
  assert.equal(await store.read(), undefined)
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

test('names the sign-in client dsh at its exact version', () => {
  assert.deepEqual(deviceInfo('0.2.1-rc.2'), { display_name: 'dsh', client_version: '0.2.1-rc.2' })
})
