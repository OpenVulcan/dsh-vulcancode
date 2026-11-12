import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { unzipSync } from 'fflate'

// Pin archive and extracted library sizes and digests from the verified VLDB release.
// 固定已验证 VLDB 发行包及其解压后库文件的大小和摘要。
export const NATIVE_VERSION = 'v0.1.5'
const assets: Record<string, readonly [suffix: string, archiveSize: number, archiveHash: string, librarySize: number, libraryHash: string]> = {
  'win32-x64': ['x86_64-pc-windows-msvc.zip', 36878527, '56fbc252680d98d89b9957f0ed7715be7fab62bd04322604c2dc9a4d2d96be2e',
    114406400, '6501a3b555a187a7d8bb7a6a5261be4c562bccba13e1cea844f3a932804ff85d'],
  'darwin-arm64': ['aarch64-apple-darwin.tar.gz', 29713554, '4ac63c8c25a408eacaaef2dc614d1775bff2499d4cd4b7335408bcb6e44935e2',
    78488432, '6bac84ea6e4d8edd43d7412b468e23246729c88356b73d58dda385bafa24202b'],
  'darwin-x64': ['x86_64-apple-darwin.tar.gz', 32606026, 'a8c6f9ef5cac80a6b9623a1e845e23bfeccea599ad8cc0a3c7ea44bc759cd790',
    88410536, 'd5a99d63d0ebd7b4676a97d5031f666caa260f3cb0b61b3f79e66cc55fbdc0ce'],
  'linux-arm64': ['aarch64-unknown-linux-gnu.tar.gz', 31345197, 'ff77797fac147685c1301911409c3b1048e00df70d298bd83d34c5e0ccee8d80',
    82895056, '79ce3fb22c44cdaea506914f19b2a8edd1c92c2221782b697781931305716027'],
  'linux-x64': ['x86_64-unknown-linux-gnu.tar.gz', 33991984, 'b4aa0d18de265523ebd56d56538193e4946d9740355dce497e1bf4821fa30cc2',
    96483640, '04943d6220b21f7b3e84d696476ebcc18e7d0cf35e33dfae09c1beee89fc6d09'],
}

// Describe whether the on-disk cache matches the pinned release.
// 描述磁盘缓存是否匹配固定的发行库。
type CacheState = 'missing' | 'damaged' | 'installed'

/** Describe the cache path and exact asset for the running Node platform, or null if unsupported.
 *  返回当前 Node 平台的缓存路径和准确发行资产，不支持时返回空值。 */
function target(root: string) {
  const platform = `${process.platform}-${process.arch}`
  const asset = assets[platform]
  if (asset === undefined) return null
  if (process.platform === 'linux' && !('glibcVersionRuntime' in (process.report.getReport() as { header: object }).header)) return null
  const name = process.platform === 'win32' ? 'vldb_lancedb.dll' : process.platform === 'darwin' ? 'libvldb_lancedb.dylib' : 'libvldb_lancedb.so'
  const [suffix, archiveSize, archiveHash, librarySize, libraryHash] = asset
  const archive = `vldb-lancedb-lib-${NATIVE_VERSION}-${suffix}`
  return { name, archive, archiveSize, archiveHash, librarySize, libraryHash, file: path.join(root, 'native', NATIVE_VERSION, platform, name) }
}

/** Stream the installed library and check its exact size and digest before loading it.
 *  加载前以流方式读取已安装库，并校验准确大小和摘要。 */
async function cacheState(release: NonNullable<ReturnType<typeof target>>): Promise<CacheState> {
  try {
    const info = await lstat(release.file)
    if (!info.isFile() || info.size !== release.librarySize) return 'damaged'
    const hash = createHash('sha256')
    let size = 0
    for await (const chunk of createReadStream(release.file)) {
      size += chunk.length
      if (size > release.librarySize) return 'damaged'
      hash.update(chunk)
    }
    return size === release.librarySize && hash.digest('hex') === release.libraryHash ? 'installed' : 'damaged'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
}

/** Report whether the current platform can download or load VLDB.
 *  报告当前平台是否可下载或加载 VLDB。 */
export async function nativeStatus(root: string): Promise<'unsupported' | CacheState> {
  const release = target(root)
  return release === null ? 'unsupported' : cacheState(release)
}

/** Return the installed library file for the running platform, when present.
 *  返回当前平台已安装的库文件路径。 */
export async function libraryPath(root: string): Promise<string | null> {
  const release = target(root)
  return release !== null && await cacheState(release) === 'installed' ? release.file : null
}

/** Fetch and verify the pinned archive, then publish only the library into the local cache.
 *  下载并校验固定版本的压缩包，再将单个库文件发布到本地缓存。 */
export async function installNative(root: string): Promise<void> {
  const release = target(root)
  if (release === null) throw new Error('VLDB is unavailable on this platform.')
  if (await cacheState(release) === 'installed') return
  const base = `https://github.com/OpenVulcan/vldb-lancedb/releases/download/${NATIVE_VERSION}`
  const response = await fetch(`${base}/${release.archive}`, { signal: AbortSignal.timeout(180_000) })
  if (!response.ok || response.body === null) throw new Error(`VLDB download failed (HTTP ${response.status}).`)
  const bytes = Buffer.alloc(release.archiveSize)
  let length = 0
  for await (const chunk of response.body) {
    if (length + chunk.length > bytes.length) throw new Error('VLDB archive exceeded the release size.')
    bytes.set(chunk, length)
    length += chunk.length
  }
  if (length !== bytes.length || createHash('sha256').update(bytes).digest('hex') !== release.archiveHash) {
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
    if (library === undefined || library.length !== release.librarySize
      || createHash('sha256').update(library).digest('hex') !== release.libraryHash) {
      throw new Error('Extracted VLDB library failed SHA-256 verification.')
    }
    await writeFile(temp, library, { flag: 'wx', mode: 0o700 })
    // Atomically replace damaged data, accepting a valid concurrent install when Windows locks the destination.
    // 原子替换损坏数据。Windows 锁定目标时，接受并发安装已发布的正确文件。
    if (await cacheState(release) === 'installed') return
    try { await rename(temp, release.file) } catch (error) {
      if (await cacheState(release) !== 'installed') throw error
    }
  } finally {
    for (const file of [temp, archiveFile]) {
      try { await unlink(file) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
}
