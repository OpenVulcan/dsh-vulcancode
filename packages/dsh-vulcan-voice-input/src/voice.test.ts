import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { CREDENTIAL_KEY, OpenVulcanAccountService } from '@openvulcan/dsh-vulcan-account'
import type { AccountStatus, Credential } from '@openvulcan/openvulcan-account'
import { MAX_AUDIO_BYTES } from './cloud.js'
import type { VoiceSelection } from './contract.js'
import { apply, VoiceInput } from './index.js'

// Synthetic, non-secret device credentials for the transport assertions.
// 用于传输断言的合成设备凭据，不含真实秘密。
const credential: Credential = {
  site: 'cn', auth_origin: 'https://auth.openvulcan.cn', access_token: 'fixture',
  authorization_id: 'fixture-device', expires_at: '2099-01-01T00:00:00Z',
}
const signedIn: AccountStatus = { signedIn: true, authorizationId: credential.authorization_id, site: credential.site }
// The site publishes a default and an alternate with an explicit language list.
// 站点发布一个默认模型和一个带明确语言列表的备选模型。
const catalog = {
  contract_version: 1, max_duration_seconds: 120, available: true, default_model_id: 'site-asr',
  models: [
    { id: 'site-asr', display_name: 'Site speech', category: 'speech_transcribe', supported_languages: [] },
    { id: 'alt-asr', display_name: 'Alternate speech', category: 'speech_transcribe', supported_languages: ['zh', 'en'] },
  ],
}

// Public projection of the fixture catalogue returned to the browser.
// 返回给浏览器的测试模型目录公开结构。
const publicCatalog = {
  defaultModelId: 'site-asr',
  models: [
    { id: 'site-asr', label: 'Site speech', languages: [] },
    { id: 'alt-asr', label: 'Alternate speech', languages: ['zh', 'en'] },
  ],
}

/**
 * Supply account methods returning a mutable status to model sign-out during requests.
 * 提供可修改状态的账号方法，用于模拟请求期间退出登录。
 */
function account(status: AccountStatus = signedIn) {
  return { current: status, async status() { return this.current }, async credential() { return credential } }
}

/**
 * Construct a canonical WAV with one PCM sample to exercise the Host request path.
 * 构造含一个 PCM 采样的标准 WAV，覆盖宿主请求路径。
 */
function wav(): Buffer<ArrayBuffer> {
  const bytes = Buffer.alloc(46)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(38, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16_000, 24)
  bytes.writeUInt32LE(32_000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(2, 40)
  return bytes
}

/**
 * Model a request from dsh's authenticated owner connection for a known authorization.
 * 模拟来自 dsh 已认证所有者连接且携带已知设备授权的请求。
 */
function upload(audio: BodyInit = wav(), id = credential.authorization_id, selection?: VoiceSelection): Request {
  // Include selection headers only when the caller explicitly picked them.
  // 仅在调用方明确选择时加入模型和语言请求头。
  const headers = new Headers({ 'content-type': 'audio/wav', 'x-vulcan-voice-authorization': id })
  if (selection !== undefined) headers.set('x-vulcan-voice-model', selection.modelId)
  if (selection?.language !== undefined) headers.set('x-vulcan-asr-language', selection.language)
  return new Request('http://localhost/api/vulcan-voice-input/transcriptions', {
    method: 'POST',
    headers,
    body: audio,
  })
}

test('the voice route follows the signed-in Cordis account service through reload and removal', async t => {
  // Mount the actual account and voice plugins so service lookups use Cordis proxies.
  // 挂载真实账号及语音插件，使服务查找经过 Cordis 代理。
  const ctx = new Context()
  const routes = new Map<string, ConnectionFetchRoute>()
  ctx.provide('credentials', {
    /**
     * Return the synthetic login grant from the same key the account page uses.
     * 从账号页使用的同一个键返回合成登录授权。
     */
    async readRecord(key: string) {
      assert.equal(key, CREDENTIAL_KEY)
      return { kind: 'grant', payload: credential }
    },
  })
  ctx.provide('connection', {
    fetch: {
      /**
       * Record the plugin's real HTTP handlers in place of dsh's socket.
       * 记录插件的真实 HTTP 处理器，代替 dsh 套接字。
       */
      register(route: ConnectionFetchRoute) {
        routes.set(route.path, route)
        return async () => { routes.delete(route.path) }
      },
    },
  })
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://auth.openvulcan.cn/api/v1/vulcancode/voice-input/capabilities')
    assert.equal(new Headers(init.headers).get('authorization'), 'Auth fixture')
    return Response.json(catalog)
  })
  const accountFiber = await ctx.plugin(OpenVulcanAccountService)
  const voiceFiber = await ctx.plugin(apply)
  t.after(async () => {
    await voiceFiber.dispose()
    await accountFiber.dispose()
  })

  /**
   * Invoke an installed status route and return its public JSON response.
   * 调用已安装的状态路由，并返回其公开 JSON 响应。
   */
  async function status(path: string) {
    const route = routes.get(path)
    assert.ok(route)
    return await (await route.fetch(new Request(`http://localhost${path}`))).json()
  }

  const voicePath = '/api/vulcan-voice-input/state'
  const expected = { status: 'ready', site: 'cn', authorizationId: 'fixture-device', catalog: publicCatalog, maxSeconds: 120 }
  assert.equal((await status('/api/vulcan-account/state')).value.account.signedIn, true)
  assert.deepEqual(await status(voicePath), expected)
  await accountFiber.restart()
  assert.deepEqual(await status(voicePath), expected)
  await accountFiber.dispose()
  assert.deepEqual(await status(voicePath), { status: 'signed_out' })
})

test('requests the current regional default and transcribes once over the native free channel', async () => {
  // Capture the exact calls instead of using the network.
  // 捕获精确请求，不访问网络。
  const calls: string[] = []
  const current = account()
  const voice = new VoiceInput(() => current, async (url, init) => {
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('authorization'), 'Auth fixture')
    assert.equal(headers.has('origin'), false)
    assert.equal(init?.redirect, 'error')
    const path = String(url)
    calls.push(path)
    if (path.endsWith('/capabilities')) return Response.json(catalog)
    assert.equal(headers.get('x-vulcan-voice-model'), 'site-asr')
    assert.equal(headers.get('content-type'), 'audio/wav')
    assert.deepEqual(Buffer.from(init?.body as Uint8Array), wav())
    return Response.json({ text: 'hello', request_id: 'receipt' })
  })
  const state = await voice.status(new Request('http://localhost/api/vulcan-voice-input/state'))
  assert.deepEqual(await state.json(), {
    status: 'ready', site: 'cn', authorizationId: 'fixture-device', catalog: publicCatalog, maxSeconds: 120,
  })
  const result = await voice.upload(upload())
  assert.deepEqual(await result.json(), { ok: true, text: 'hello' })
  assert.deepEqual(calls, ['capabilities', 'capabilities', 'transcriptions'].map(
    path => `https://auth.openvulcan.cn/api/v1/vulcancode/voice-input/${path}`,
  ))
})

test('forwards an explicit model and language, rejecting withdrawn selections before uploading audio', async () => {
  // Track transcription calls separately from publication checks.
  // 分开跟踪转写调用与模型目录检查。
  let posts = 0
  const current = account()
  const voice = new VoiceInput(() => current, async (url, init) => {
    if (String(url).endsWith('/capabilities')) return Response.json(catalog)
    posts += 1
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('x-vulcan-voice-model'), 'alt-asr')
    assert.equal(headers.get('x-vulcan-asr-language'), 'zh')
    return Response.json({ text: '你好', request_id: 'receipt' })
  })
  const accepted = await voice.upload(upload(wav(), credential.authorization_id, { modelId: 'alt-asr', language: 'zh' }))
  assert.deepEqual(await accepted.json(), { ok: true, text: '你好' })
  for (const selection of [{ modelId: 'removed-asr' }, { modelId: 'alt-asr', language: 'ja' }]) {
    const rejected = await voice.upload(upload(wav(), credential.authorization_id, selection))
    assert.equal(rejected.status, 409)
    assert.deepEqual(await rejected.json(), { ok: false, code: 'selection_unavailable' })
  }
  assert.equal(posts, 1)
})

test('rejects signed-out, stale, oversized and malformed recordings before contacting OpenVulcan', async () => {
  const current = account({ signedIn: false })
  const voice = new VoiceInput(() => current, async () => assert.fail('no upstream request expected'))
  assert.equal((await voice.upload(upload())).status, 401)
  current.current = signedIn
  assert.equal((await voice.upload(upload(wav(), 'old-device'))).status, 401)
  assert.equal((await voice.upload(upload(new Uint8Array(MAX_AUDIO_BYTES + 1)))).status, 413)
  assert.equal((await voice.upload(upload(new Uint8Array(46)))).status, 400)
})

test('rejects a disabled publication and never submits the recording', async () => {
  const current = account()
  const voice = new VoiceInput(() => current, async (url) => {
    assert.match(String(url), /\/capabilities$/)
    return Response.json({ ...catalog, available: false, default_model_id: '', models: [] })
  })
  const response = await voice.upload(upload())
  assert.deepEqual(await response.json(), { ok: false, code: 'unavailable' })
})

test('discards an in-flight transcript after the authorization changes', async () => {
  const current = account()
  const voice = new VoiceInput(() => current, async (url, init) => {
    if (String(url).endsWith('/capabilities')) return Response.json(catalog)
    current.current = { signedIn: false }
    voice.accountChanged()
    assert.equal(init?.signal?.aborted, true)
    return Response.json({ text: 'stale', request_id: 'receipt' })
  })
  const response = await voice.upload(upload())
  assert.deepEqual(await response.json(), { ok: false, code: 'signed_out' })
})

test('exposes the upstream retry time without resubmitting audio', async () => {
  const current = account()
  let posts = 0
  const voice = new VoiceInput(() => current, async (url) => {
    if (String(url).endsWith('/capabilities')) return Response.json(catalog)
    posts += 1
    return Response.json({ error: { code: 'voice_rate_limited' } }, { status: 429, headers: { 'retry-after': '21' } })
  })
  const response = await voice.upload(upload())
  assert.deepEqual(await response.json(), { ok: false, code: 'rate_limited', retryAfter: 21 })
  assert.equal(posts, 1)
})
