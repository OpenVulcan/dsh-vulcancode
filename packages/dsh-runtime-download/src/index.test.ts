import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GITHUB, GITHUB_MIRRORS, githubUrl, mirrorBase, selectGitHubMirror } from './index.js'

// Use the same exact release path for direct, prefix and layout-style sources.
// 直连、前缀代理及目录型镜像使用同一份准确发行路径。
const sample = 'https://github.com/LuaSkills/luaskills/releases/download/v0.9.0/asset.tar.gz'

// A manually selected HTTPS mirror never triggers probes or rewrites another host.
// 手动指定 HTTPS 镜像时不测速，也不改写其他宿主。
test('normalizes custom mirrors and respects an explicit direct choice', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected fetch') })
  assert.equal(await selectGitHubMirror(sample, GITHUB), GITHUB)
  assert.equal(mirrorBase('https://mirror.example/'), 'https://mirror.example/https://github.com')
  assert.equal(mirrorBase('https://mirror.example/github/'), 'https://mirror.example/github')
  assert.equal(githubUrl('https://github.com.example/asset', 'https://mirror.example'), 'https://github.com.example/asset')
  assert.throws(() => mirrorBase('https://user:secret@mirror.example'))
  assert.equal(fetch.mock.callCount(), 0)
})

// Validate range requests and reject landing pages even when a server answers HTTP 200.
// 验证范围请求，且即使服务器返回 HTTP 200 也拒绝落地网页。
test('automatic selection uses a working archive mirror', async t => {
  const winner = GITHUB_MIRRORS[2].base
  t.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit) => {
    assert.equal(new Headers(request.headers).get('range'), 'bytes=0-65535')
    return url.startsWith(winner)
      ? new Response(new Uint8Array(65_536), { status: 206, headers: { 'content-type': 'application/octet-stream' } })
      : new Response('<html>landing page</html>', { headers: { 'content-type': 'text/html' } })
  })
  assert.equal(await selectGitHubMirror(sample, null), winner)
})
