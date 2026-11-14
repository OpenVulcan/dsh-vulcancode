/**
 * Install and validate one version in its own directory, then commit the active installation in installed.json.
 * 在独立目录安装并验证一个版本，再通过 installed.json 提交当前运行版本。
 */

import { readFileSync } from 'node:fs'
import { cp, lstat, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  DEFAULT_SKILL, HUB_SITES, LUA_RUNTIME_VERSION, LUASKILLS_VERSION, RUNTIME_SIZE_MB, SDK_PACKAGE, SDK_PACKAGES,
} from './constants.js'
import { LuaSkillsWorker } from './engine.js'
import { installPackages, packageDir } from './sdk-install.js'
import {
  engineOptions, loadSettings, parseSettings, saveSettings, type LoadedSettings, type LuaSkillsSettings,
} from './settings.js'
import { resolveWorkerExecutable } from './worker-host.js'

export interface Versions {
  readonly sdk: string
  readonly luaskills: string
  readonly luaRuntime: string
}

/** The versions this plugin installs. */
export const PINNED: Versions = { sdk: SDK_PACKAGE.version, luaskills: LUASKILLS_VERSION, luaRuntime: LUA_RUNTIME_VERSION }

// The installed tuple supported as the source and rollback target of this upgrade.
// 此次升级支持的来源及回退目标版本组合。
const PREVIOUS: Versions = { sdk: '0.6.7', luaskills: 'v0.7.2', luaRuntime: 'v0.1.8' }

/** Install steps, in the order the SDK fetches the runtime archives. */
export const PHASES = ['sdk', 'lua', 'core', 'engine', 'skill'] as const
export type Phase = (typeof PHASES)[number]

export type RuntimeState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'installing'; readonly phase: Phase; readonly received: number; readonly total: number | null }
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'outdated'; readonly installed: Versions; readonly canUpgrade: boolean; readonly error?: string }
  /** `installed` says whether the runtime is on disk (the engine failed) or not (the install failed). */
  | { readonly kind: 'failed'; readonly error: string; readonly installed: boolean }

/** Everything the pages show about the runtime, in one answer. */
export interface RuntimeView {
  readonly state: RuntimeState
  readonly location: string
  readonly sizeMb: number
  readonly versions: Versions
  readonly installed?: Versions
  readonly upgradeError?: string
  readonly settings: LuaSkillsSettings
  /** `defaults` until the user saves once. */
  readonly settingsSource: 'defaults' | 'saved' | 'invalid'
  readonly settingsError?: string
  readonly hubSites: typeof HUB_SITES
}

export class RuntimeError extends Error {
  constructor(message: string, readonly code: 'not_ready' | 'busy' | 'invalid_request' = 'not_ready') {
    super(message)
  }
}

/** The active installation record. Legacy installations have no version directory.
 *  当前安装记录。旧版安装没有独立版本目录。 */
interface Marker extends Versions {
  readonly platform: string
  readonly installedAt: string
  readonly slot?: string
}

// Keep one lifecycle operation and its cancellation scope until cleanup finishes.
// 生命周期操作及其取消范围保留到清理完成，期间只允许一个操作。
interface LifecycleOperation {
  readonly kind: 'install' | 'change'
  readonly controller: AbortController
  readonly result: Promise<void>
}

export class LuaSkillsRuntime {
  private readonly marker: string
  private readonly settingsFile: string
  private readonly versionsDirectory: string
  private active: Marker | undefined
  private upgradeError: string | undefined
  private state: RuntimeState = { kind: 'absent' }
  private worker: LuaSkillsWorker | undefined
  private loaded: LoadedSettings
  private operation: LifecycleOperation | undefined
  private requests: Promise<void> = Promise.resolve()
  private closing: Promise<void> | undefined
  private closed = false

  /**
   * @param home - this plugin's folder in the dsh home.
   * @param changed - called after every state change.
   */
  constructor(readonly home: string, private readonly changed: () => void) {
    this.marker = path.join(home, 'installed.json')
    this.settingsFile = path.join(home, 'settings.json')
    this.versionsDirectory = path.join(home, 'versions')
    this.loaded = loadSettings(this.settingsFile)
  }

  get current(): RuntimeState {
    return this.state
  }

  /** Resolve the active runtime used by the engine and installed-skills page.
   *  解析引擎和已安装技能页面当前使用的运行目录。 */
  get runtimeRoot(): string {
    return path.join(this.installationDirectory(this.active), 'runtime')
  }

  view(): RuntimeView {
    return {
      state: this.state,
      location: this.home,
      sizeMb: RUNTIME_SIZE_MB,
      versions: PINNED,
      ...this.active === undefined ? {} : { installed: this.active },
      ...this.upgradeError === undefined ? {} : { upgradeError: this.upgradeError },
      settings: this.loaded.settings,
      settingsSource: this.loaded.kind,
      ...this.loaded.kind === 'invalid' ? { settingsError: this.loaded.error } : {},
      hubSites: HUB_SITES,
    }
  }

  get settings(): LuaSkillsSettings {
    return this.loaded.settings
  }

  /** The running engine. @throws RuntimeError when it is not ready. */
  engine(): LuaSkillsWorker {
    if (this.closed || this.state.kind !== 'ready' || this.worker === undefined) throw new RuntimeError('the LuaSkills runtime is not running')
    return this.worker
  }

  /** Start the installed runtime, if there is one this version can use. */
  async boot(): Promise<void> {
    try {
      await this.runExclusive('change', async signal => {
        const installed = this.readMarker()
        if (installed === undefined) return
        this.active = installed
        if (!this.canRun(installed)) {
          this.set({ kind: 'outdated', installed, canUpgrade: false })
          return
        }
        await this.start(signal)
      })
    } catch (error) {
      if (!this.closed) this.set({ kind: 'failed', error: messageOf(error), installed: this.active !== undefined })
      throw error
    }
  }

  /** Begin installing in the background; progress shows in the state. */
  install(): void {
    if (this.active !== undefined && matchesVersions(this.active, PINNED) && this.state.kind === 'ready') {
      throw new RuntimeError('the LuaSkills runtime is already installed', 'busy')
    }
    void this.runExclusive('install', signal => this.runInstall(signal)).catch(error => {
      if (this.closed) return
      if (this.state.kind === 'ready' || this.state.kind === 'outdated') {
        this.upgradeError = messageOf(error)
        this.changed()
      } else {
        this.set({ kind: 'failed', error: messageOf(error), installed: this.active !== undefined })
      }
    })
  }

  /** Stop the running install; what it wrote is removed. */
  cancel(): void {
    if (this.operation?.kind === 'install') this.operation.controller.abort(new Error('the install was cancelled'))
  }

  /** Stop the engine and delete the runtime; settings are kept. */
  async remove(): Promise<void> {
    await this.runExclusive('change', async () => {
      this.assertActive()
      await this.stopWorker()
      try {
        for (const directory of [this.versionsDirectory, ...['sdk', 'runtime', 'download', 'worker-host'].map(name => path.join(this.home, name))]) {
          await rm(directory, { recursive: true, force: true, maxRetries: 3 })
        }
        await rm(this.marker, { force: true })
        this.active = undefined
        this.upgradeError = undefined
        this.set({ kind: 'absent' })
      } catch (error) {
        this.set({ kind: 'failed', error: messageOf(error), installed: this.active !== undefined })
        throw error
      }
    })
  }

  /** Restart the engine with the current settings. */
  async restart(): Promise<void> {
    await this.runExclusive('change', async signal => {
      if (this.active === undefined) throw new RuntimeError('the LuaSkills runtime is not installed')
      this.assertActive()
      if (!this.canRun(this.active)) throw new RuntimeError('This LuaSkills version cannot be started by this plugin.')
      await this.start(signal)
    })
  }

  /**
   * Check and save the settings, then restart a running engine so they apply.
   * @throws SettingsError when the value is not valid; nothing is written then.
   */
  async saveSettings(value: unknown): Promise<void> {
    await this.runExclusive('change', async signal => {
      this.assertActive()
      const settings = parseSettings(value)
      saveSettings(this.settingsFile, settings)
      this.loaded = { kind: 'saved', settings }
      if (this.active !== undefined && this.canRun(this.active) && (this.state.kind === 'ready' || this.state.kind === 'failed')) await this.start(signal)
      else if (!this.closed) this.changed()
    })
  }

  /** Cancel current work and wait for its cleanup before releasing the runtime.
   *  取消当前工作并等待其清理完成，再释放运行库。 */
  async close(): Promise<void> {
    if (this.closing === undefined) {
      this.closed = true
      const operation = this.operation
      operation?.controller.abort(new Error('the LuaSkills runtime is closing'))
      this.closing = (async () => {
        // An active tool can hold the request queue while a lifecycle operation waits behind it.
        // 活跃工具可能占用请求队列，而生命周期操作正在其后等待。
        if (this.state.kind === 'ready') await this.stopWorker()
        try { await operation?.result } catch { /* The operation's caller receives its error. */ }
        await this.stopWorker()
        await this.requests
      })()
    }
    await this.closing
  }

  /** Acquire ownership synchronously, then run the supplied lifecycle change with its abort signal.
   *  同步取得归属权，再用专属取消信号执行所提供的生命周期变更。 */
  private runExclusive(kind: LifecycleOperation['kind'], work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.closed) throw new RuntimeError('the LuaSkills runtime is closed')
    if (this.operation !== undefined) throw new RuntimeError('the LuaSkills runtime is busy', 'busy')
    const controller = new AbortController()
    const result = this.requests.then(async () => {
      if (controller.signal.aborted) return
      try {
        await this.lock(() => work(controller.signal), controller.signal)
      } catch (error) {
        if (!controller.signal.aborted) throw error
      }
    }).finally(() => {
      if (this.operation?.result === result) this.operation = undefined
    })
    this.operation = { kind, controller, result }
    return result
  }

  private set(state: RuntimeState): void {
    this.state = state
    if (!this.closed) this.changed()
  }

  /** Resolve one recorded installation without moving its native files or generated manifests.
   *  解析已记录的安装路径，避免移动原生文件或已生成的清单。 */
  private installationDirectory(marker: Marker | undefined): string {
    return marker?.slot === undefined ? this.home : path.join(this.versionsDirectory, marker.slot)
  }

  /** Find the SDK entry for an isolated installation directory.
   *  查找独立安装目录中的 SDK 入口。 */
  private sdkEntry(directory: string): string {
    return path.join(packageDir(path.join(directory, 'sdk', 'node_modules'), SDK_PACKAGE.name), 'dist', 'index.js')
  }

  /** Serialize filesystem and worker operations against other DSH instances using the same home.
   *  将同一主目录下不同 DSH 实例的文件与进程操作串行化。 */
  private async lock<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await mkdir(this.home, { recursive: true })
    return withFileLock(this.marker, work, { ...signal === undefined ? {} : { signal }, waitMs: 5_000 })
  }

  /** Run a request only while this instance still owns the active installation it loaded.
   *  仅当本实例加载的版本仍是当前安装版本时执行请求。 */
  async useEngine<T>(work: (worker: LuaSkillsWorker) => Promise<T>): Promise<T> {
    if (this.operation !== undefined) throw new RuntimeError('the LuaSkills runtime is busy', 'busy')
    const worker = this.engine()
    const result = this.requests.then(async () => {
      if (this.closed) throw new RuntimeError('the LuaSkills runtime is closed')
      return this.lock(async () => {
        if (this.closed) throw new RuntimeError('the LuaSkills runtime is closed')
        this.assertActive()
        if (this.engine() !== worker) throw new RuntimeError('The LuaSkills worker changed. Retry the request.')
        return work(worker)
      })
    })
    this.requests = result.then(() => {}, () => {})
    return result
  }

  /** Reject operations against a version another instance has replaced or removed.
   *  其他实例已替换或移除运行版本时，拒绝对旧版本执行操作。 */
  private assertActive(): void {
    if (!sameInstallation(this.active, this.readMarker())) {
      throw new RuntimeError('The LuaSkills installation changed in another DSH instance. Reload this plugin.')
    }
  }

  /** Check both the native platform and the supported SDK/core pairs.
   *  同时校验原生平台和受支持的 SDK 与核心版本组合。 */
  private canRun(marker: Marker): boolean {
    return marker.platform === `${process.platform}-${process.arch}`
      && (matchesVersions(marker, PINNED) || matchesVersions(marker, PREVIOUS))
  }

  private readMarker(): Marker | undefined {
    try {
      const marker = JSON.parse(readFileSync(this.marker, 'utf8')) as Partial<Marker> | null
      if (marker === null || typeof marker.sdk !== 'string' || typeof marker.luaskills !== 'string' || typeof marker.luaRuntime !== 'string'
        || typeof marker.platform !== 'string' || typeof marker.installedAt !== 'string'
        || (marker.slot !== undefined && (typeof marker.slot !== 'string' || !/^install-[a-zA-Z0-9]{6}$/.test(marker.slot)))) {
        throw new Error('Invalid LuaSkills installation marker.')
      }
      return marker as Marker
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  /** Create a worker without changing the active installation.
   *  创建进程，保持当前安装指针不变。 */
  private async createWorker(directory: string, signal: AbortSignal): Promise<LuaSkillsWorker> {
    // Provision the host under the same lifecycle lock as the Lua runtime.
    // 在 Lua 运行库的同一生命周期锁下准备 Worker 宿主。
    const executable = await resolveWorkerExecutable(path.join(this.home, 'worker-host'), signal)
    signal.throwIfAborted()
    const worker = new LuaSkillsWorker(this.sdkEntry(directory), (error) => {
      if (this.worker !== worker) return
      this.worker = undefined
      if (this.state.kind === 'ready' || this.state.kind === 'starting') this.set({ kind: 'failed', error: error.message, installed: true })
    }, executable)
    return worker
  }

  /** Start tracking the worker of the selected installation.
   *  开始跟踪所选安装的进程。 */
  private async spawn(directory: string, signal: AbortSignal): Promise<LuaSkillsWorker> {
    const worker = await this.createWorker(directory, signal)
    this.worker = worker
    return worker
  }

  private async stopWorker(): Promise<void> {
    const worker = this.worker
    this.worker = undefined
    await worker?.stop()
  }

  /** Start the selected version and report its availability after the worker responds.
   *  启动所选版本，在进程响应后发布可用状态。 */
  private async start(signal: AbortSignal): Promise<void> {
    this.set({ kind: 'starting' })
    try {
      await this.stopWorker()
      signal.throwIfAborted()
      this.assertActive()
      const worker = await this.spawn(this.installationDirectory(this.active), signal)
      await abortable(worker.start({ runtimeRoot: this.runtimeRoot, ...engineOptions(this.loaded.settings) }), signal)
      signal.throwIfAborted()
      this.set({ kind: 'ready' })
    } catch (error) {
      await this.stopWorker()
      if (!this.closed) {
        if (this.active !== undefined && matchesVersions(this.active, PREVIOUS)) {
          this.set({ kind: 'outdated', installed: this.active, canUpgrade: true, error: messageOf(error) })
        } else {
          this.set({ kind: 'failed', error: messageOf(error), installed: true })
        }
      }
    }
  }

  /** Stage an installation, migrate and validate its skills, then publish its marker.
   *  暂存安装、迁移并验证技能，最后发布安装标记。 */
  private async runInstall(signal: AbortSignal): Promise<void> {
    const progress = (phase: Phase, received = 0, total: number | null = null) => {
      this.set({ kind: 'installing', phase, received, total })
    }
    const started = Date.now()
    this.assertActive()
    const previous = this.active
    if (previous !== undefined && !this.canRun(previous)) throw new RuntimeError('This LuaSkills version cannot be upgraded by this plugin.', 'invalid_request')
    const previousRoot = this.runtimeRoot
    this.upgradeError = undefined
    let directory: string | undefined
    let worker: LuaSkillsWorker | undefined
    let expectedSkills: Awaited<ReturnType<LuaSkillsWorker['help']>> | undefined
    try {
      progress('sdk')
      await mkdir(this.versionsDirectory, { recursive: true })
      directory = await mkdtemp(path.join(this.versionsDirectory, 'install-'))
      await this.installSdk(directory, signal, (received, total) => progress('sdk', received, total))
      signal.throwIfAborted()

      progress('lua')
      worker = await this.createWorker(directory, signal)
      worker.onDownload = (role, received, total) => {
        throttled(() => { progress(role === 'lua_runtime' ? 'lua' : 'core', received, total) }, received === total || received === 0)
      }
      const runtimeRoot = path.join(directory, 'runtime')
      await abortable(worker.installRuntime({ runtimeRoot, luaskillsVersion: LUASKILLS_VERSION, luaRuntimeVersion: LUA_RUNTIME_VERSION }), signal)
      worker.onDownload = undefined

      progress('engine')
      if (previous !== undefined) {
        if (this.worker !== undefined) expectedSkills = await abortable(this.worker.help(), signal)
        await this.stopWorker()
        await copyRuntimeData(previousRoot, runtimeRoot, signal)
      }
      signal.throwIfAborted()
      await abortable(worker.start({ runtimeRoot, ...engineOptions(this.loaded.settings) }), signal)

      progress('skill')
      if (!await installedDefaultSkill(runtimeRoot)) {
        const result = await abortable(worker.install('ROOT', {
          skill_id: DEFAULT_SKILL.skillId, source: DEFAULT_SKILL.source, source_type: DEFAULT_SKILL.sourceType,
        }), signal)
        if (!['installed', 'updated', 'up_to_date'].includes(result.status)) throw new Error(`${DEFAULT_SKILL.skillId}: ${result.message}`)
      }
      const loaded = await abortable(worker.help(), signal)
      const loadedKeys = new Set(loaded.map(skill => `${skill.root_name}/${skill.skill_id}`))
      // Compare all enabled installations when the old engine could not start and supply a catalog.
      // 旧引擎无法启动并提供目录时，对照磁盘上的所有已启用技能。
      const keys = expectedSkills === undefined ? await enabledSkills(runtimeRoot)
        : expectedSkills.map(skill => `${skill.root_name}/${skill.skill_id}`)
      for (const key of keys) {
        if (!loadedKeys.has(key)) throw new Error(`LuaSkills could not load ${key} after upgrading.`)
      }
      if (!await isDisabled(runtimeRoot, DEFAULT_SKILL.skillId) && !loadedKeys.has(`ROOT/${DEFAULT_SKILL.skillId}`)) {
        throw new Error(`LuaSkills could not load ${DEFAULT_SKILL.skillId}.`)
      }
      await rm(path.join(directory, 'download'), { recursive: true, force: true })
      this.assertActive()
      signal.throwIfAborted()
      const marker: Marker = { ...PINNED, platform: `${process.platform}-${process.arch}`, installedAt: new Date().toISOString(), slot: path.basename(directory) }
      // Publishing the marker commits the upgrade. The candidate must survive cancellation after this point.
      // 发布标记即提交升级。此后收到的取消请求不能删除已启用的版本。
      await writeFileAtomic(this.marker, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 })
      this.active = marker
      this.worker = worker
    } catch (error) {
      await worker?.kill()
      if (directory !== undefined) await rm(directory, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
      if (worker?.pid !== undefined) await removeSdkScratch(worker.pid, started).catch(() => {})
      if (this.closed) return
      if (!signal.aborted) this.upgradeError = messageOf(error)
      if (previous === undefined) {
        this.upgradeError = undefined
        this.set(signal.aborted ? { kind: 'absent' } : { kind: 'failed', error: messageOf(error), installed: false })
      } else if (this.worker !== undefined) {
        this.set({ kind: 'ready' })
      } else {
        await this.start(new AbortController().signal)
      }
      return
    }
    this.set({ kind: 'ready' })
  }

  /** Download the pinned Node packages into the candidate, reporting throttled progress.
   *  将固定版本的 Node 包下载到候选目录，并按节流规则报告进度。 */
  private async installSdk(directory: string, signal: AbortSignal, progress: (received: number, total: number | null) => void): Promise<void> {
    await installPackages(SDK_PACKAGES, path.join(directory, 'sdk', 'node_modules'), path.join(directory, 'download'), signal,
      (_index, received, total) => { throttled(() => progress(received, total), received === total) })
  }
}

/** Check one runtime's complete pinned version tuple.
 *  校验运行库的完整固定版本组合。 */
function matchesVersions(left: Versions, right: Versions): boolean {
  return left.sdk === right.sdk && left.luaskills === right.luaskills && left.luaRuntime === right.luaRuntime
}

/** Match the selected installation, including its generation when the version tuple is unchanged.
 *  比较所选安装记录，即使版本组合相同也要核对安装代次。 */
function sameInstallation(left: Marker | undefined, right: Marker | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return matchesVersions(left, right) && left.slot === right.slot && left.installedAt === right.installedAt && left.platform === right.platform
}

/** Probe an optional data path and report unreadable paths as errors.
 *  探测可选数据路径，遇到无法读取的路径时显式报错。 */
async function pathExists(file: string): Promise<boolean> {
  try {
    await lstat(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Copy persisted skill data after stopping the old worker. Rebuild the SDK-owned assets in the candidate.
 *  停止旧进程后复制技能持久化数据，SDK 所有的资源在候选目录重新安装。 */
async function copyRuntimeData(source: string, destination: string, signal: AbortSignal): Promise<void> {
  for (const name of ['root_skills', 'project_skills', 'user_skills', 'state', 'config', 'databases', 'dependencies', 'bin', 'system_lua_lib']) {
    signal.throwIfAborted()
    const from = path.join(source, name)
    if (!await pathExists(from)) continue
    await cp(from, path.join(destination, name), {
      recursive: true,
      verbatimSymlinks: true,
      filter: file => {
        signal.throwIfAborted()
        // Pending install staging and virtual environments are regenerated. Their paths can refer to the old root.
        // 安装暂存和虚拟环境会重新生成，其中的路径可能指向旧运行目录。
        const relative = path.relative(source, file)
        return relative !== path.join('state', 'install_tmp') && relative !== path.join('dependencies', 'envs')
      },
    })
  }
}

/** Check whether the candidate already has the bundled skill, including a disabled copy.
 *  检查候选目录是否已经安装默认技能，包括已停用的副本。 */
function installedDefaultSkill(runtimeRoot: string): Promise<boolean> {
  return pathExists(path.join(runtimeRoot, 'root_skills', DEFAULT_SKILL.skillId, 'skill.yaml'))
}

/** Check the persisted disable marker used by the LuaSkills skill manager.
 *  检查 LuaSkills 技能管理器使用的持久化停用标记。 */
function isDisabled(runtimeRoot: string, skillId: string): Promise<boolean> {
  return pathExists(path.join(runtimeRoot, 'state', 'skills', 'disabled', `${skillId}.json`))
}

/** Read the effective enabled skill IDs in the SDK's ROOT, PROJECT, USER order.
 *  按 SDK 的 ROOT、PROJECT、USER 顺序读取实际启用的技能标识。 */
async function enabledSkills(runtimeRoot: string): Promise<string[]> {
  const seen = new Set<string>()
    const keys: string[] = []
  for (const [layer, folder] of [['ROOT', 'root_skills'], ['PROJECT', 'project_skills'], ['USER', 'user_skills']] as const) {
    const root = path.join(runtimeRoot, folder)
    if (!await pathExists(root)) continue
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || seen.has(entry.name) || !await pathExists(path.join(root, entry.name, 'skill.yaml'))) continue
      seen.add(entry.name)
      if (!await isDisabled(runtimeRoot, entry.name)) keys.push(`${layer}/${entry.name}`)
    }
  }
  return keys
}

/**
 * The SDK unpacks runtime archives in `<tmpdir>/luaskills-runtime-assets-<pid>-<ms>` and removes it
 * itself, unless the worker is stopped first; remove the ones this install left behind.
 */
async function removeSdkScratch(pid: number, since: number): Promise<void> {
  const prefix = `luaskills-runtime-assets-${pid}-`
  for (const name of await readdir(tmpdir())) {
    if (name.startsWith(prefix) && Number(name.slice(prefix.length)) >= since) {
      await rm(path.join(tmpdir(), name), { recursive: true, force: true, maxRetries: 3 })
    }
  }
}

let lastReport = 0
/** Report download progress at most every 200 ms, and always the last one. */
function throttled(report: () => void, final: boolean): void {
  const now = Date.now()
  if (!final && now - lastReport < 200) return
  lastReport = now
  report()
}

/** Wait for a worker result or cancellation and keep observing any late worker rejection.
 *  等待 worker 返回结果或收到取消信号，并继续接收取消后到达的 worker 错误。 */
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => { reject(signal.reason) }
    work.then(result => {
      signal.removeEventListener('abort', onAbort)
      resolve(result)
    }, error => {
      signal.removeEventListener('abort', onAbort)
      reject(error)
    })
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
