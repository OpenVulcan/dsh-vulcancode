/**
 * The LuaSkills runtime's lifecycle: absent until the user installs it, then installed in five
 * steps with progress, started on every dsh start while its versions match, restarted when
 * settings change, and removable. A failed or cancelled install leaves nothing half-installed.
 *
 * Layout below the plugin's folder in the dsh home:
 * - `sdk/node_modules/` — the SDK and Koffi;
 * - `runtime/` — the SDK's runtime root (core library, Lua packages, skill layers, state);
 * - `installed.json` — written last; without it the runtime counts as not installed;
 * - `settings.json` — the user's settings, kept when the runtime is removed.
 */

import { existsSync, readFileSync } from 'node:fs'
import { readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  DEFAULT_SKILL, HUB_SITES, LUA_RUNTIME_VERSION, LUASKILLS_VERSION, RUNTIME_SIZE_MB, SDK_PACKAGE, SDK_PACKAGES,
} from './constants.js'
import { LuaSkillsWorker } from './engine.js'
import { installPackages, packageDir } from './sdk-install.js'
import {
  engineOptions, loadSettings, parseSettings, saveSettings, type LoadedSettings, type LuaSkillsSettings,
} from './settings.js'

export interface Versions {
  readonly sdk: string
  readonly luaskills: string
  readonly luaRuntime: string
}

/** The versions this plugin installs. */
export const PINNED: Versions = { sdk: SDK_PACKAGE.version, luaskills: LUASKILLS_VERSION, luaRuntime: LUA_RUNTIME_VERSION }

/** Install steps, in the order the SDK fetches the runtime archives. */
export const PHASES = ['sdk', 'lua', 'core', 'engine', 'skill'] as const
export type Phase = (typeof PHASES)[number]

export type RuntimeState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'installing'; readonly phase: Phase; readonly received: number; readonly total: number | null }
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready' }
  /** Installed by another plugin version; it is not started until reinstalled. */
  | { readonly kind: 'outdated'; readonly installed: Versions }
  /** `installed` says whether the runtime is on disk (the engine failed) or not (the install failed). */
  | { readonly kind: 'failed'; readonly error: string; readonly installed: boolean }

/** Everything the pages show about the runtime, in one answer. */
export interface RuntimeView {
  readonly state: RuntimeState
  readonly location: string
  readonly sizeMb: number
  readonly versions: Versions
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

interface Marker extends Versions {
  readonly platform: string
  readonly installedAt: string
}

export class LuaSkillsRuntime {
  readonly runtimeRoot: string
  private readonly nodeModules: string
  private readonly marker: string
  private readonly settingsFile: string
  private readonly scratch: string
  private state: RuntimeState = { kind: 'absent' }
  private worker: LuaSkillsWorker | undefined
  private loaded: LoadedSettings
  private installing: AbortController | undefined
  private closed = false

  /**
   * @param home - this plugin's folder in the dsh home.
   * @param changed - called after every state change.
   */
  constructor(readonly home: string, private readonly changed: () => void) {
    this.runtimeRoot = path.join(home, 'runtime')
    this.nodeModules = path.join(home, 'sdk', 'node_modules')
    this.marker = path.join(home, 'installed.json')
    this.settingsFile = path.join(home, 'settings.json')
    this.scratch = path.join(home, 'download')
    this.loaded = loadSettings(this.settingsFile)
  }

  get current(): RuntimeState {
    return this.state
  }

  view(): RuntimeView {
    return {
      state: this.state,
      location: this.home,
      sizeMb: RUNTIME_SIZE_MB,
      versions: PINNED,
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
    if (this.state.kind !== 'ready' || this.worker === undefined) throw new RuntimeError('the LuaSkills runtime is not running')
    return this.worker
  }

  /** Start the installed runtime, if there is one this version can use. */
  async boot(): Promise<void> {
    const installed = this.readMarker()
    if (installed === undefined) return
    if (installed.sdk !== PINNED.sdk || installed.luaskills !== PINNED.luaskills || installed.luaRuntime !== PINNED.luaRuntime) {
      this.set({ kind: 'outdated', installed: { sdk: installed.sdk, luaskills: installed.luaskills, luaRuntime: installed.luaRuntime } })
      return
    }
    await this.start()
  }

  /** Begin installing in the background; progress shows in the state. */
  install(): void {
    if (this.state.kind === 'installing' || this.state.kind === 'starting') throw new RuntimeError('the LuaSkills runtime is busy', 'busy')
    if (this.state.kind === 'ready') throw new RuntimeError('the LuaSkills runtime is already installed', 'busy')
    const controller = new AbortController()
    this.installing = controller
    void this.runInstall(controller.signal).finally(() => {
      if (this.installing === controller) this.installing = undefined
    })
  }

  /** Stop the running install; what it wrote is removed. */
  cancel(): void {
    this.installing?.abort(new Error('the install was cancelled'))
  }

  /** Stop the engine and delete the runtime; settings are kept. */
  async remove(): Promise<void> {
    if (this.state.kind === 'installing' || this.state.kind === 'starting') throw new RuntimeError('the LuaSkills runtime is busy', 'busy')
    await this.stopWorker()
    await this.wipe()
    this.set({ kind: 'absent' })
  }

  /** Restart the engine with the current settings. */
  async restart(): Promise<void> {
    if (this.state.kind === 'installing' || this.state.kind === 'starting') throw new RuntimeError('the LuaSkills runtime is busy', 'busy')
    if (this.readMarker() === undefined) throw new RuntimeError('the LuaSkills runtime is not installed')
    await this.start()
  }

  /**
   * Check and save the settings, then restart a running engine so they apply.
   * @throws SettingsError when the value is not valid; nothing is written then.
   */
  async saveSettings(value: unknown): Promise<void> {
    if (this.state.kind === 'installing' || this.state.kind === 'starting') throw new RuntimeError('the LuaSkills runtime is busy', 'busy')
    const settings = parseSettings(value)
    saveSettings(this.settingsFile, settings)
    this.loaded = { kind: 'saved', settings }
    if (this.state.kind === 'ready' || (this.state.kind === 'failed' && this.state.installed)) await this.start()
    else this.changed()
  }

  async close(): Promise<void> {
    this.closed = true
    this.cancel()
    await this.stopWorker()
  }

  private set(state: RuntimeState): void {
    this.state = state
    if (!this.closed) this.changed()
  }

  private sdkEntry(): string {
    return path.join(packageDir(this.nodeModules, SDK_PACKAGE.name), 'dist', 'index.js')
  }

  private readMarker(): Marker | undefined {
    try {
      const marker = JSON.parse(readFileSync(this.marker, 'utf8')) as Partial<Marker>
      if (typeof marker.sdk !== 'string' || typeof marker.luaskills !== 'string' || typeof marker.luaRuntime !== 'string') return undefined
      if (!existsSync(this.sdkEntry()) || !existsSync(this.runtimeRoot)) return undefined
      return marker as Marker
    } catch {
      return undefined
    }
  }

  private spawn(): LuaSkillsWorker {
    const worker = new LuaSkillsWorker(this.sdkEntry(), (error) => {
      if (this.worker !== worker) return
      this.worker = undefined
      if (this.state.kind === 'ready' || this.state.kind === 'starting') this.set({ kind: 'failed', error: error.message, installed: true })
    })
    this.worker = worker
    return worker
  }

  private async stopWorker(): Promise<void> {
    const worker = this.worker
    this.worker = undefined
    await worker?.stop()
  }

  private async start(): Promise<void> {
    await this.stopWorker()
    this.set({ kind: 'starting' })
    try {
      const worker = this.spawn()
      await worker.start({ runtimeRoot: this.runtimeRoot, ...engineOptions(this.loaded.settings) })
      this.set({ kind: 'ready' })
    } catch (error) {
      await this.stopWorker()
      this.set({ kind: 'failed', error: messageOf(error), installed: true })
    }
  }

  private async wipe(): Promise<void> {
    // The marker goes first, so an interrupted removal never looks installed.
    await rm(this.marker, { force: true })
    for (const folder of [path.join(this.home, 'sdk'), this.runtimeRoot, this.scratch]) {
      await rm(folder, { recursive: true, force: true, maxRetries: 3 })
    }
  }

  private async runInstall(signal: AbortSignal): Promise<void> {
    const progress = (phase: Phase, received = 0, total: number | null = null) => {
      this.set({ kind: 'installing', phase, received, total })
    }
    const started = Date.now()
    try {
      progress('sdk')
      await this.stopWorker()
      await this.wipe()
      await installPackages(SDK_PACKAGES, this.nodeModules, this.scratch, signal, (_index, received, total) => {
        throttled(() => { progress('sdk', received, total) }, received === total)
      })
      signal.throwIfAborted()

      progress('lua')
      const worker = this.spawn()
      worker.onDownload = (role, received, total) => {
        throttled(() => { progress(role === 'lua_runtime' ? 'lua' : 'core', received, total) }, received === total || received === 0)
      }
      await abortable(worker.installRuntime({ runtimeRoot: this.runtimeRoot, luaskillsVersion: LUASKILLS_VERSION, luaRuntimeVersion: LUA_RUNTIME_VERSION }), signal)
      worker.onDownload = undefined

      progress('engine')
      await abortable(worker.start({ runtimeRoot: this.runtimeRoot, ...engineOptions(this.loaded.settings) }), signal)

      progress('skill')
      const result = await abortable(worker.install('ROOT', {
        skill_id: DEFAULT_SKILL.skillId, source: DEFAULT_SKILL.source, source_type: DEFAULT_SKILL.sourceType,
      }), signal)
      if (!['installed', 'updated', 'up_to_date'].includes(result.status)) throw new Error(`${DEFAULT_SKILL.skillId}: ${result.message}`)

      const marker: Marker = { ...PINNED, platform: `${process.platform}-${process.arch}`, installedAt: new Date().toISOString() }
      await writeFile(this.marker, `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
      await rm(this.scratch, { recursive: true, force: true })
      this.set({ kind: 'ready' })
    } catch (error) {
      const worker = this.worker
      this.worker = undefined
      await worker?.kill()
      await this.wipe().catch(() => {})
      if (worker?.pid !== undefined) await removeSdkScratch(worker.pid, started).catch(() => {})
      if (signal.aborted) this.set({ kind: 'absent' })
      else this.set({ kind: 'failed', error: messageOf(error), installed: false })
    }
  }
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

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => { reject(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(resolve, reject).finally(() => { signal.removeEventListener('abort', onAbort) })
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
