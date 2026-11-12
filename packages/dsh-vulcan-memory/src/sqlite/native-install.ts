import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { link, mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { unzipSync } from 'fflate'

// Pin the verified VLDB ABI and archive digests from its public release.
// 固定已验证的 VLDB ABI 版本和公开发行包的摘要。
export const NATIVE_VERSION = 'v0.1.5'
const assets: Record<string, readonly [string, number, string]> = {
  'win32-x64': ['x86_64-pc-windows-msvc.zip', 36878527, '56fbc252680d98d89b9957f0ed7715be7fab62bd04322604c2dc9a4d2d96be2e'],
  'darwin-arm64': ['aarch64-apple-darwin.tar.gz', 29713554, '4ac63c8c25a408eacaaef2dc614d1775bff2499d4cd4b7335408bcb6e44935e2'],
  'darwin-x64': ['x86_64-apple-darwin.tar.gz', 32606026, 'a8c6f9ef5cac80a6b9623a1e845e23bfeccea599ad8cc0a3c7ea44bc759cd790'],
  'linux-arm64': ['aarch64-unknown-linux-gnu.tar.gz', 31345197, 'ff77797fac147685c1301911409c3b1048e00df70d298bd83d34c5e0ccee8d80'],
  'linux-x64': ['x86_64-unknown-linux-gnu.tar.gz', 33991984, 'b4aa0d18de265523ebd56d56538193e4946d9740355dce497e1bf4821fa30cc2'],
}

/** Describe the cache path and exact asset for the running Node platform, or null if unsupported.
 *  返回当前 Node 平台的缓存路径和准确发行资产，不支持时返回空值。 */
function target(root: string) {
  const platform = `${process.platform}-${process.arch}`
  const asset = assets[platform]
  if (asset === undefined) return null
  if (process.platform === 'linux' && !('glibcVersionRuntime' in (process.report.getReport() as { header: object }).header)) return null
  const name = process.platform === 'win32' ? 'vldb_lancedb.dll' : process.platform === 'darwin' ? 'libvldb_lancedb.dylib' : 'libvldb_lancedb.so'
  const archive = `vldb-lancedb-lib-${NATIVE_VERSION}-${asset[0]}`
  return { name, archive, size: asset[1], digest: asset[2], file: path.join(root, 'native', NATIVE_VERSION, platform, name) }
}

/** Report whether the current platform can download or load VLDB.
 *  报告当前平台是否可下载或加载 VLDB。 */
export function nativeStatus(root: string): 'unsupported' | 'missing' | 'installed' {
  const release = target(root)
  return release === null ? 'unsupported' : existsSync(release.file) ? 'installed' : 'missing'
}

/** Return the installed library file for the running platform, when present.
 *  返回当前平台已安装的库文件路径。 */
export function libraryPath(root: string): string | null {
  const release = target(root)
  return release !== null && existsSync(release.file) ? release.file : null
}

/** Fetch and verify the pinned archive, then publish only the library into the local cache.
 *  下载并校验固定版本的压缩包，再将单个库文件发布到本地缓存。 */
export async function installNative(root: string): Promise<void> {
  const release = target(root)
  if (release === null) throw new Error('VLDB is unavailable on this platform.')
  if (existsSync(release.file)) return
  const base = `https://github.com/OpenVulcan/vldb-lancedb/releases/download/${NATIVE_VERSION}`
  const response = await fetch(`${base}/${release.archive}`, { signal: AbortSignal.timeout(180_000) })
  if (!response.ok || response.body === null) throw new Error(`VLDB download failed (HTTP ${response.status}).`)
  const bytes = Buffer.alloc(release.size)
  let length = 0
  for await (const chunk of response.body) {
    if (length + chunk.length > bytes.length) throw new Error('VLDB archive exceeded the release size.')
    bytes.set(chunk, length)
    length += chunk.length
  }
  if (length !== bytes.length || createHash('sha256').update(bytes).digest('hex') !== release.digest) {
    throw new Error('VLDB archive failed SHA-256 verification.')
  }
  const directory = path.dirname(release.file)
  await mkdir(directory, { recursive: true })
  const temp = path.join(directory, randomUUID())
  const archiveFile = `${temp}.tar.gz`
  try {
    let library: Uint8Array | undefined
    if (release.archive.endsWith('.zip')) {
      library = unzipSync(bytes, { filter: file => file.name === release.name })[release.name]
    } else {
      await writeFile(archiveFile, bytes, { flag: 'wx' })
      const entry = `${release.archive.slice(0, -'.tar.gz'.length)}/${release.name}`
      const result = await promisify(execFile)('tar', ['-xOzf', archiveFile, entry], {
        encoding: 'buffer', maxBuffer: 160 * 1024 * 1024, timeout: 30_000,
      })
      library = result.stdout
    }
    if (library === undefined || library.length === 0) throw new Error('VLDB archive did not contain the expected library.')
    await writeFile(temp, library, { flag: 'wx', mode: 0o700 })
    // Publish atomically without replacing a DLL another process has already loaded.
    // 原子发布库文件，避免覆盖其他进程已经加载的 DLL。
    try { await link(temp, release.file) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  } finally {
    for (const file of [temp, archiveFile]) {
      try { await unlink(file) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
}
