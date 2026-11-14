import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

// Use the official standalone Node x64 distribution as the Windows Worker host.
// Windows Worker 使用 Node 官方 x64 独立发行版。
const WINDOWS_NODE = {
  url: 'https://nodejs.org/dist/v24.18.0/win-x64/node.exe',
  sha256: '9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de',
  file: 'node-24.18.0-x64-utf8-v1.exe',
  preparedSha256: '13a4cd93c3af9102bef2ef6cd5ec2c81ccbcccbf034e6b7c7f01b298edad5445',
} as const

/** Build an isolated environment from the parent; Lua computes default paths before loading skills.
 * 从父进程环境生成隔离配置；Lua 会在加载技能前计算默认搜索路径。 */
export function workerEnvironment(parent: NodeJS.ProcessEnv, useElectron: boolean): NodeJS.ProcessEnv {
  // Remove unversioned and version-specific Lua overrides before the native CRT starts.
  // 在原生 CRT 初始化前移除无版本和带版本号的 Lua 覆盖变量。
  const env = Object.fromEntries(Object.entries(parent).filter(([key]) =>
    !/^(?:LUA_(?:PATH|CPATH|INIT)(?:_\d+_\d+)?|ELECTRON_RUN_AS_NODE)$/i.test(key)))
  if (useElectron) env.ELECTRON_RUN_AS_NODE = '1'
  return env
}

/** Return the SHA-256 hex digest for the exact bytes passed in.
 * 返回传入二进制内容的 SHA-256 十六进制摘要。 */
function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Add the UTF-8 process code page to the pinned Node executable and return the revised PE.
 * 将 UTF-8 进程代码页写入固定版本的 Node 可执行文件，并返回修改后的 PE。 */
export async function prepareWindowsNode(bytes: Uint8Array): Promise<Buffer> {
  if (sha256(bytes) !== WINDOWS_NODE.sha256) throw new Error('The Windows LuaSkills worker download failed SHA-256 verification.')
  // Edit a dedicated Node copy so Windows sets the code page before LuaJIT uses any narrow APIs.
  // 只修改独立 Node 副本，使 Windows 在 LuaJIT 调用窄字符 API 前设定代码页。
  const { NtExecutable, NtExecutableResource } = await import('resedit')
  // Editing the verified image invalidates Authenticode, so emit the generated image without its certificate.
  // 修改已校验的镜像会使 Authenticode 签名失效，因此生成的镜像不保留证书。
  const executable = NtExecutable.from(bytes, { ignoreCert: true })
  const resources = NtExecutableResource.from(executable)
  const [manifest] = resources.getResourceEntriesAsString(24, 1)
  if (!manifest || !manifest[1].includes('</assembly>') || manifest[1].includes('activeCodePage')) {
    throw new Error('The Windows LuaSkills worker has an unexpected application manifest.')
  }
  // This is the same application setting as VulcanCode, embedded in the executable the Worker runs.
  // 在 Worker 实际使用的可执行文件中嵌入 VulcanCode 同款应用设置。
  const utf8 = '<application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings>' +
    '<activeCodePage xmlns="http://schemas.microsoft.com/SMI/2019/WindowsSettings">UTF-8</activeCodePage>' +
    '</windowsSettings></application>'
  resources.replaceResourceEntryFromString(24, 1, manifest[0], manifest[1].replace('</assembly>', utf8 + '</assembly>'))
  resources.outputResource(executable)
  return Buffer.from(executable.generate())
}

/** Return the Worker executable, using a verified UTF-8 Node copy under the plugin home on Windows.
 * 返回 Worker 可执行文件路径；Windows 使用插件目录下经过校验的 UTF-8 Node 副本。 */
export async function resolveWorkerExecutable(home: string, signal: AbortSignal): Promise<string> {
  if (process.platform !== 'win32') return process.execPath
  if (process.arch !== 'x64') throw new Error(`LuaSkills has no Windows Worker for ${process.arch}.`)
  // The shared cache is independent of runtime slots so upgrade, restart and rollback use the same host.
  // Worker 缓存独立于运行库版本目录，升级、重启与回滚共用同一个宿主。
  const destination = path.join(home, WINDOWS_NODE.file)
  try {
    if (sha256(await readFile(destination)) === WINDOWS_NODE.preparedSha256) return destination
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const response = await fetch(WINDOWS_NODE.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) })
  if (!response.ok) throw new Error(`The Windows LuaSkills worker download failed (HTTP ${response.status}).`)
  const prepared = await prepareWindowsNode(new Uint8Array(await response.arrayBuffer()))
  if (sha256(prepared) !== WINDOWS_NODE.preparedSha256) throw new Error('The generated Windows LuaSkills worker failed SHA-256 verification.')
  signal.throwIfAborted()
  await writeFileAtomic(destination, prepared, { mode: 0o700 })
  return destination
}
