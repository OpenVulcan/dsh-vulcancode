/**
 * LuaSkills runtime settings. Fields, defaults and limits follow VulcanCode's
 * `luaskills-runtime-setting.json`; the settings file belongs to this plugin and is written only
 * when the user saves. A missing file means the defaults, held in memory.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { HUB_SITES } from './constants.js'

/** One VM pool: the size it keeps warm, the size it may grow to, and how long an idle VM lives. */
export interface PoolSettings {
  readonly minSize: number
  readonly maxSize: number
  readonly idleTtlSecs: number
}

export interface LuaSkillsSettings {
  /** The main pool skill calls run in. */
  readonly vmPool: PoolSettings
  /** The isolated pool `runLua` runs in. */
  readonly runLuaPool: PoolSettings
  readonly toolCache: {
    readonly maxEntries: number
    readonly defaultTtlSecs: number
    readonly maxTtlSecs: number
  }
  readonly managedRuntime: {
    readonly workerPoolMaxSizePerEnvironment: number
    readonly workerIdleTtlSecs: number
    readonly persistentSessionLimitPerEngine: number
    readonly persistentSessionDefaultBufferLimitBytesPerStream: number
    readonly invokeDefaultTimeoutMs: number
  }
  readonly capabilities: {
    /** Null leaves the choice to LuaSkills. */
    readonly defaultTextEncoding: TextEncoding | null
    readonly enableSkillManagementBridge: boolean
    readonly enableManagedIoCompat: boolean
  }
  readonly network: {
    readonly allowDownloads: boolean
    /** Null uses `https://github.com`. */
    readonly githubBaseUrl: string | null
    /** Null uses `https://api.github.com`. */
    readonly githubApiBaseUrl: string | null
    readonly officialSkillHubBaseUrl: string
  }
}

export const TEXT_ENCODINGS = ['utf-8', 'system', 'oem', 'gbk', 'gb18030', 'latin1', 'base64'] as const
export type TextEncoding = (typeof TEXT_ENCODINGS)[number]

export const DEFAULT_SETTINGS: LuaSkillsSettings = {
  vmPool: { minSize: 4, maxSize: 8, idleTtlSecs: 60 },
  runLuaPool: { minSize: 1, maxSize: 4, idleTtlSecs: 30 },
  toolCache: { maxEntries: 1000, defaultTtlSecs: 1800, maxTtlSecs: 1800 },
  managedRuntime: {
    workerPoolMaxSizePerEnvironment: 4,
    workerIdleTtlSecs: 60,
    persistentSessionLimitPerEngine: 256,
    persistentSessionDefaultBufferLimitBytesPerStream: 1_048_576,
    invokeDefaultTimeoutMs: 60_000,
  },
  capabilities: { defaultTextEncoding: null, enableSkillManagementBridge: false, enableManagedIoCompat: true },
  network: { allowDownloads: true, githubBaseUrl: null, githubApiBaseUrl: null, officialSkillHubBaseUrl: HUB_SITES[0].url },
}

export class SettingsError extends Error {
  readonly code = 'invalid_settings'
}

type Shape = { readonly [key: string]: 'count' | 'boolean' | 'encoding' | 'url' | 'optional-url' | Shape }

const POOL: Shape = { minSize: 'count', maxSize: 'count', idleTtlSecs: 'count' }
const SHAPE: Shape = {
  vmPool: POOL,
  runLuaPool: POOL,
  toolCache: { maxEntries: 'count', defaultTtlSecs: 'count', maxTtlSecs: 'count' },
  managedRuntime: {
    workerPoolMaxSizePerEnvironment: 'count',
    workerIdleTtlSecs: 'count',
    persistentSessionLimitPerEngine: 'count',
    persistentSessionDefaultBufferLimitBytesPerStream: 'count',
    invokeDefaultTimeoutMs: 'count',
  },
  capabilities: { defaultTextEncoding: 'encoding', enableSkillManagementBridge: 'boolean', enableManagedIoCompat: 'boolean' },
  network: { allowDownloads: 'boolean', githubBaseUrl: 'optional-url', githubApiBaseUrl: 'optional-url', officialSkillHubBaseUrl: 'url' },
}

/**
 * Check a whole settings value: every field present, nothing extra, counts positive whole
 * numbers, every maximum at least its minimum, URLs absolute http(s).
 * @throws SettingsError naming the first offending field.
 */
export function parseSettings(value: unknown): LuaSkillsSettings {
  check(value, SHAPE, 'settings')
  const settings = value as LuaSkillsSettings
  for (const [name, pool] of [['vmPool', settings.vmPool], ['runLuaPool', settings.runLuaPool]] as const) {
    if (pool.maxSize < pool.minSize) throw new SettingsError(`${name}.maxSize must be at least ${name}.minSize`)
  }
  if (settings.toolCache.maxTtlSecs < settings.toolCache.defaultTtlSecs) {
    throw new SettingsError('toolCache.maxTtlSecs must be at least toolCache.defaultTtlSecs')
  }
  return settings
}

function check(value: unknown, shape: Shape, at: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SettingsError(`${at} must be an object`)
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!(key in shape)) throw new SettingsError(`${at}.${key} is not a setting`)
  }
  for (const [key, kind] of Object.entries(shape)) {
    const field = record[key]
    const name = `${at}.${key}`
    if (typeof kind === 'object') {
      check(field, kind, name)
    } else if (kind === 'count') {
      if (!Number.isSafeInteger(field) || (field as number) <= 0) throw new SettingsError(`${name} must be a whole number above zero`)
    } else if (kind === 'boolean') {
      if (typeof field !== 'boolean') throw new SettingsError(`${name} must be true or false`)
    } else if (kind === 'encoding') {
      if (field !== null && !TEXT_ENCODINGS.includes(field as TextEncoding)) {
        throw new SettingsError(`${name} must be null or one of ${TEXT_ENCODINGS.join(', ')}`)
      }
    } else if (!(kind === 'optional-url' && field === null) && !isHttpUrl(field)) {
      throw new SettingsError(`${name} must be an absolute http or https URL`)
    }
  }
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** What reading the settings file found. */
export type LoadedSettings =
  | { readonly kind: 'defaults'; readonly settings: LuaSkillsSettings }
  | { readonly kind: 'saved'; readonly settings: LuaSkillsSettings }
  | { readonly kind: 'invalid'; readonly settings: LuaSkillsSettings; readonly error: string }

/**
 * Read the settings file. An unreadable file is reported and the defaults are used in memory;
 * the file is left untouched so nothing the user wrote is lost.
 */
export function loadSettings(file: string): LoadedSettings {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'defaults', settings: DEFAULT_SETTINGS }
    return { kind: 'invalid', settings: DEFAULT_SETTINGS, error: messageOf(error) }
  }
  try {
    return { kind: 'saved', settings: parseSettings(JSON.parse(raw)) }
  } catch (error) {
    return { kind: 'invalid', settings: DEFAULT_SETTINGS, error: `${file}: ${messageOf(error)}` }
  }
}

/** Write the settings file whole, through a temporary file so a crash leaves the old one. */
export function saveSettings(file: string, settings: LuaSkillsSettings): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  renameSync(temporary, file)
}

/** The engine options a settings value turns into, in the SDK's wire names. */
export function engineOptions(settings: LuaSkillsSettings): { poolConfig: Record<string, unknown>; hostOptions: Record<string, unknown> } {
  const pool = (value: PoolSettings) => ({ min_size: value.minSize, max_size: value.maxSize, idle_ttl_secs: value.idleTtlSecs })
  const managed = settings.managedRuntime
  return {
    poolConfig: pool(settings.vmPool),
    hostOptions: {
      runlua_pool_config: pool(settings.runLuaPool),
      cache_config: {
        max_entries: settings.toolCache.maxEntries,
        default_ttl_secs: settings.toolCache.defaultTtlSecs,
        max_ttl_secs: settings.toolCache.maxTtlSecs,
      },
      managed_runtime_config: {
        worker_pool_max_size_per_environment: managed.workerPoolMaxSizePerEnvironment,
        worker_idle_ttl_secs: managed.workerIdleTtlSecs,
        persistent_session_limit_per_engine: managed.persistentSessionLimitPerEngine,
        persistent_session_default_buffer_limit_bytes_per_stream: managed.persistentSessionDefaultBufferLimitBytesPerStream,
        invoke_default_timeout_ms: managed.invokeDefaultTimeoutMs,
      },
      capabilities: {
        enable_skill_management_bridge: settings.capabilities.enableSkillManagementBridge,
        enable_managed_io_compat: settings.capabilities.enableManagedIoCompat,
      },
      // Read by the Rust core although the SDK's TypeScript type does not list them.
      ...settings.capabilities.defaultTextEncoding === null ? {} : { default_text_encoding: settings.capabilities.defaultTextEncoding },
      official_skill_hub_base_url: settings.network.officialSkillHubBaseUrl,
      allow_network_download: settings.network.allowDownloads,
      github_base_url: settings.network.githubBaseUrl,
      github_api_base_url: settings.network.githubApiBaseUrl,
    },
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
