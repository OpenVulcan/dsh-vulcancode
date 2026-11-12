import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { installNative, libraryPath, nativeStatus, NATIVE_VERSION } from './native-install.js'

test('damaged native cache is unavailable and can be downloaded again', async (t) => {
  // Use a truncated cache fixture, and intercept the download before any network request.
  // 使用截断的缓存样本，并在任何网络请求发出前拦截下载。
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-vldb-cache-'))
  try {
    const status = await nativeStatus(root)
    if (status === 'unsupported') { t.skip('No published VLDB library for this platform'); return }
    assert.equal(status, 'missing')
    const name = process.platform === 'win32' ? 'vldb_lancedb.dll'
      : process.platform === 'darwin' ? 'libvldb_lancedb.dylib' : 'libvldb_lancedb.so'
    const file = path.join(root, 'native', NATIVE_VERSION, `${process.platform}-${process.arch}`, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, '')
    assert.equal(await nativeStatus(root), 'damaged')
    assert.equal(await libraryPath(root), null)
    const download = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }))
    await assert.rejects(installNative(root), /HTTP 503/)
    assert.equal(download.mock.callCount(), 1)
    assert.equal(await nativeStatus(root), 'damaged')
  } finally { await rm(root, { recursive: true, force: true }) }
})
