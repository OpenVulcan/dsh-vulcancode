import { lstat, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import type { ManagedKind, ManagedStatus, ManagedView } from './protocol.js'

/** SDK installation inputs limited to downloading interpreters into the supplied root.
 * 将 SDK 安装输入限定为向给定目录下载解释器。 */
interface InstallOptions {
  readonly runtimeRoot: string
  readonly luaRuntimeVersion: string
  readonly managedRuntimes: ManagedKind | 'all'
  readonly includeLuaRuntime: false
  readonly includeLuaSkillsFfi: false
  readonly database: 'none'
}

/** SDK plan values needed to inspect and publish one managed distribution.
 * 检查和安装受管发行版所需的 SDK 计划字段。 */
interface Plan {
  readonly platform: { readonly platform_key: string; readonly uv_executable: string }
  readonly installed_paths: Record<ManagedKind | 'pnpm' | 'uv', string>
  readonly node_version: string
  readonly python_version: string
  readonly pnpm_version: string
  readonly uv_version: string
}

/** SDK 0.9.0 entry points used by the managed-runtime installer.
 * 受管运行时安装使用的 SDK 0.9.0 入口。 */
interface ManagedSdk {
  buildRuntimeInstallManifest(options: InstallOptions): { managed_runtimes: Plan }
  installRuntimeAssets(options: InstallOptions): Promise<unknown>
  resolveLuaSkillsLibraryPathFromRuntime(runtimeRoot: string): string | null
  LuaSkillsClient: {
    resolveManagedRuntimeInstall(options: {
      libraryPath: string; runtimeRoot: string; distributionRoot: string; runtime: ManagedKind; version: string; platform: string
    }): { executable: string }
  }
}

/** Return the exact SDK options for a catalog check or interpreter-only installation.
 * 返回检查状态或仅安装解释器所需的精确 SDK 选项。 */
function options(runtimeRoot: string, luaRuntimeVersion: string, managedRuntimes: InstallOptions['managedRuntimes']): InstallOptions {
  return { runtimeRoot, luaRuntimeVersion, managedRuntimes, includeLuaRuntime: false, includeLuaSkillsFfi: false, database: 'none' }
}

/** Inspect one companion package's manifest and executable without consulting PATH.
 * 检查配套包的清单和可执行文件，使用发行目录内的文件。 */
async function managerReady(root: string, plan: Plan, manager: 'pnpm' | 'uv', version: string): Promise<boolean> {
  const directory = path.join(root, plan.installed_paths[manager])
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, 'runtime-manifest.json'), 'utf8')) as {
      runtime: string; version: string; executable: string
    }
    const expected = manager === 'pnpm' ? 'bin/pnpm.cjs' : plan.platform.uv_executable
    if (manifest.runtime !== manager || manifest.version !== version || manifest.executable !== expected) return false
    return (await lstat(path.join(directory, expected))).isFile()
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Resolve an interpreter through the core and ensure its pinned package manager is present.
 * 通过核心解析解释器，并检查固定版本包管理器是否存在。 */
async function readStatus(sdk: ManagedSdk, runtimeRoot: string, plan: Plan, kind: ManagedKind): Promise<ManagedStatus> {
  const version = kind === 'node' ? plan.node_version : plan.python_version
  const packageManagerVersion = kind === 'node' ? plan.pnpm_version : plan.uv_version
  const missing = { version, packageManagerVersion, executable: null }
  try {
    const manifest = path.join(runtimeRoot, plan.installed_paths[kind], 'runtime-manifest.json')
    await lstat(manifest)
    if (!await managerReady(runtimeRoot, plan, kind === 'node' ? 'pnpm' : 'uv', packageManagerVersion)) return missing
    // Bind validation to the same installation as the Worker, even if LUASKILLS_LIB was inherited.
    // 即使继承了 LUASKILLS_LIB，也使用当前 Worker 对应的安装验证解释器。
    const libraryPath = sdk.resolveLuaSkillsLibraryPathFromRuntime(runtimeRoot)
    if (libraryPath === null) throw new Error('The LuaSkills core is missing from the managed runtime slot.')
    const { executable } = sdk.LuaSkillsClient.resolveManagedRuntimeInstall({
      libraryPath, runtimeRoot, distributionRoot: path.join(runtimeRoot, 'dependencies', 'runtimes'),
      runtime: kind, version, platform: plan.platform.platform_key,
    })
    return { version, packageManagerVersion, executable }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? missing
      : { ...missing, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Report both runtimes for the given LuaSkills slot using the SDK's pinned versions.
 * 使用 SDK 固定版本报告指定 LuaSkills 目录中的两个运行时。 */
export async function inspectManaged(sdk: ManagedSdk, runtimeRoot: string, luaRuntimeVersion: string): Promise<ManagedView> {
  const { managed_runtimes: plan } = sdk.buildRuntimeInstallManifest(options(runtimeRoot, luaRuntimeVersion, 'all'))
  const [node, python] = await Promise.all([readStatus(sdk, runtimeRoot, plan, 'node'), readStatus(sdk, runtimeRoot, plan, 'python')])
  return { root: path.join(runtimeRoot, 'dependencies', 'runtimes'), node, python }
}

/** Install a missing runtime and its package manager in staging, then replace only those two directories.
 * 在暂存目录安装缺失的运行时和包管理器，然后仅替换这两个目录。 */
export async function installManaged(sdk: ManagedSdk, runtimeRoot: string, luaRuntimeVersion: string, kind: ManagedKind): Promise<void> {
  const { managed_runtimes: plan } = sdk.buildRuntimeInstallManifest(options(runtimeRoot, luaRuntimeVersion, kind))
  if ((await readStatus(sdk, runtimeRoot, plan, kind)).executable !== null) return
  const dependencies = path.join(runtimeRoot, 'dependencies')
  await mkdir(dependencies, { recursive: true })
  const stage = await mkdtemp(path.join(dependencies, '.managed-'))
  const oldCwd = process.cwd()
  // Make the SDK's uv invocation private to this installation instead of modifying user-level Python commands.
  // 将 SDK 的 uv 调用限制在此次安装中，避免修改用户级 Python 命令。
  const uvFlags = { UV_PYTHON_INSTALL_BIN: '0', UV_PYTHON_INSTALL_REGISTRY: '0', UV_NO_CONFIG: '1', UV_MANAGED_PYTHON: '1' }
  const oldFlags = Object.fromEntries(Object.keys(uvFlags).map(key => [key, process.env[key]]))
  // Record backed-up slots so an error on the second rename can restore the first.
  // 记录被备份的目录，第二次更换失败时可恢复第一次更换。
  const moved: { target: string; backup: string | null; installed: boolean }[] = []
  let recoverable = true
  try {
    process.chdir(stage)
    Object.assign(process.env, uvFlags)
    await sdk.installRuntimeAssets(options(stage, luaRuntimeVersion, kind))
    for (const name of [kind, kind === 'node' ? 'pnpm' : 'uv'] as const) {
      const relative = plan.installed_paths[name]
      const target = path.join(runtimeRoot, relative)
      const backup = path.join(stage, `previous-${name}`)
      await mkdir(path.dirname(target), { recursive: true })
      const entry = { target, backup: null as string | null, installed: false }
      moved.push(entry)
      try {
        await rename(target, backup)
        entry.backup = backup
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await rename(path.join(stage, relative), target)
      entry.installed = true
    }
    const status = await readStatus(sdk, runtimeRoot, plan, kind)
    if (status.executable === null) throw new Error(status.error ?? `Managed ${kind} verification failed.`)
  } catch (error) {
    for (const entry of moved.reverse()) {
      try {
        if (entry.installed) await rm(entry.target, { recursive: true, force: true })
        if (entry.backup !== null) await rename(entry.backup, entry.target)
      } catch {
        recoverable = false
      }
    }
    if (!recoverable) throw new Error(`Managed ${kind} rollback failed. Recovery files: ${stage}`, { cause: error })
    throw error
  } finally {
    process.chdir(oldCwd)
    for (const [key, value] of Object.entries(oldFlags)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    if (recoverable) await rm(stage, { recursive: true, force: true })
  }
}
