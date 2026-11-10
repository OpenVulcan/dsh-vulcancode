import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

// The browser build exports CommonJS for dsh's module loader.
// 浏览器构建产物以 CommonJS 形式提供给 dsh 的模块加载器。
const shared = readFileSync(new URL('../build/client/shared.js', import.meta.url), 'utf8')
// The mock account service returns this authorization destination.
// 模拟账号服务返回此授权地址。
const approvalUrl = 'https://openvulcan.cn/authorize'

/**
 * Run the client module with a simulated popup policy and account request, returning its sign-in function.
 * 使用模拟的弹窗策略和账号请求执行客户端模块，并返回其登录函数。
 */
function loadSignIn(open: (...args: string[]) => object | null, fetch: typeof globalThis.fetch) {
  // The compiled module assigns its sign-in function to this object.
  // 编译后的模块会将登录函数写入此对象。
  const exports: { startAccountSignIn?: (site: 'cn' | 'global') => Promise<void> } = {}
  runInNewContext(shared, { exports, fetch, window: { open } })
  assert.ok(exports.startAccountSignIn)
  return exports.startAccountSignIn
}

test('dsh Desktop receives the real URL on the first sign-in click when it denies the blank window', async (t) => {
  // Electron returns no window handle even when the system browser receives the URL.
  // 即使系统浏览器收到地址，Electron 也不会返回窗口句柄。
  const open = t.mock.fn(() => null)
  // Capture the API call and supply an authorization URL for the selected site.
  // 记录接口调用，并提供所选站点的授权地址。
  const request = t.mock.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(input, '/api/vulcan-account/signin?site=cn')
    assert.equal(init?.method, 'POST')
    return Response.json({ ok: true, value: { approvalUrl } })
  })
  await loadSignIn(open, request)('cn')
  assert.equal(request.mock.callCount(), 1)
  assert.deepEqual(open.mock.calls.map(call => Array.from(call.arguments)), [
    ['about:blank', '_blank'],
    [approvalUrl, '_blank', 'noopener,noreferrer'],
  ])
})

test('the web client reserves one tab before the account request and reuses it', async (t) => {
  // The browser gives the click a usable tab and records where it is sent.
  // 浏览器为点击提供可用的标签页，并记录其跳转地址。
  const popup = { closed: false, opener: {}, location: { replace: t.mock.fn() } }
  // Count popup requests to verify that successful sign-in uses the original tab.
  // 统计弹窗请求次数，验证登录使用原先打开的标签页。
  const open = t.mock.fn(() => popup)
  await loadSignIn(open, async () => {
    assert.equal(open.mock.callCount(), 1)
    return Response.json({ ok: true, value: { approvalUrl } })
  })('global')
  assert.equal(popup.opener, null)
  assert.deepEqual(popup.location.replace.mock.calls.map(call => Array.from(call.arguments)), [[approvalUrl]])
  assert.equal(open.mock.callCount(), 1)
})

test('a rejected sign-in request closes the reserved tab and reports the service error', async (t) => {
  // Track cleanup of the blank tab opened during the click.
  // 记录点击时打开的空白标签页是否被关闭。
  const close = t.mock.fn()
  await assert.rejects(loadSignIn(() => ({ close }), async () => Response.json({ ok: false, error: { message: 'Sign-in unavailable' } }))('cn'), /Sign-in unavailable/)
  assert.equal(close.mock.callCount(), 1)
})
