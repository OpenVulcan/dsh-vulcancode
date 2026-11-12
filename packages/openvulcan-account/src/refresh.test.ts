import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OpenVulcanAccount, SITES, type Credential, type CredentialStore } from './account.js'

// Use only synthetic credentials and a controlled response to exercise concurrent reads.
// 仅使用合成凭据与可控响应验证并行读取。
const current: Credential = {
  site: 'cn', auth_origin: SITES.cn.auth, authorization_id: 'fixture',
  access_token: 'a'.repeat(43), expires_at: new Date(Date.now() + 3600_000).toISOString(),
}
const refreshed = { ...current, access_token: 'b'.repeat(43), expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() }

/** Build an account backed by a mutable test store, without writing user credentials.
 *  使用可变测试存储构造账号，不写入用户凭据。 */
function fixture() {
  let value: Credential | undefined = current
  const store: CredentialStore = {
    read: async () => value,
    write: async credential => { value = credential },
    delete: async () => { value = undefined },
  }
  return { account: new OpenVulcanAccount(store, { display_name: 'fixture', client_version: 'test' }), store }
}

test('parallel credential reads join a live rotation and keep the signed-in status', async (t) => {
  const { account, store } = fixture()
  const requested = Promise.withResolvers<void>()
  const response = Promise.withResolvers<Response>()
  const transport = t.mock.method(globalThis, 'fetch', async () => {
    requested.resolve()
    return response.promise
  })
  const first = account.credential()
  await requested.promise
  assert.equal((await store.read())?.rotation_pending, true)
  const second = account.credential()
  const status = await account.status()
  assert.equal(status.signedIn, true)
  assert.equal(status.reauthRequired, undefined)
  response.resolve(Response.json({ ...refreshed, token_type: 'Auth' }))
  assert.deepEqual(await Promise.all([first, second]), [refreshed, refreshed])
  assert.equal(transport.mock.callCount(), 1)
})
