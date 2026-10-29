/** Facts the browser half shares with the Host half. */

/** Checked against `package.json` by `scripts/bundle-client.mjs`. */
export const PACKAGE_NAME = '@openvulcan/dsh-vulcan-luaskills'
/** The Settings dialog entry this plugin adds. */
export const SETTINGS_SECTION = 'vulcan-luaskills'
/** The main panel the sidebar entry opens. */
export const PANEL_ID = 'vulcan-luaskills'
/** Mirrors `ROUTE_PREFIX` in `src/index.ts`, below the page's origin. */
const ROUTE_BASE = '/api/vulcan-luaskills/'

/** Mirrors `PHASES` in `src/runtime.ts`. */
export const PHASES = ['sdk', 'core', 'lua', 'engine', 'skill'] as const
export type Phase = (typeof PHASES)[number]

/** Mirrors `RuntimeState` in `src/runtime.ts`. */
export type RuntimeState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'installing'; readonly phase: Phase; readonly received: number; readonly total: number | null }
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'outdated'; readonly installed: Versions }
  | { readonly kind: 'failed'; readonly error: string; readonly installed: boolean }

export interface Versions {
  readonly sdk: string
  readonly luaskills: string
  readonly luaRuntime: string
}

export interface PoolSettings {
  readonly minSize: number
  readonly maxSize: number
  readonly idleTtlSecs: number
}

/** Mirrors `LuaSkillsSettings` in `src/settings.ts`. */
export interface LuaSkillsSettings {
  readonly vmPool: PoolSettings
  readonly runLuaPool: PoolSettings
  readonly toolCache: { readonly maxEntries: number; readonly defaultTtlSecs: number; readonly maxTtlSecs: number }
  readonly managedRuntime: {
    readonly workerPoolMaxSizePerEnvironment: number
    readonly workerIdleTtlSecs: number
    readonly persistentSessionLimitPerEngine: number
    readonly persistentSessionDefaultBufferLimitBytesPerStream: number
    readonly invokeDefaultTimeoutMs: number
  }
  readonly capabilities: {
    readonly defaultTextEncoding: string | null
    readonly enableSkillManagementBridge: boolean
    readonly enableManagedIoCompat: boolean
  }
  readonly network: {
    readonly allowDownloads: boolean
    readonly githubBaseUrl: string | null
    readonly githubApiBaseUrl: string | null
    readonly officialSkillHubBaseUrl: string
  }
}

/** Mirrors `TEXT_ENCODINGS` in `src/settings.ts`. */
export const TEXT_ENCODINGS = ['utf-8', 'system', 'oem', 'gbk', 'gb18030', 'latin1', 'base64'] as const

/** Mirrors `RuntimeView` in `src/runtime.ts`. */
export interface RuntimeView {
  readonly state: RuntimeState
  readonly location: string
  readonly sizeMb: number
  readonly versions: Versions
  readonly settings: LuaSkillsSettings
  readonly settingsSource: 'defaults' | 'saved' | 'invalid'
  readonly settingsError?: string
  readonly hubSites: readonly { readonly site: 'global' | 'cn'; readonly url: string }[]
}

/** Mirrors `SkillRow` in `src/index.ts`. */
export interface SkillRow {
  readonly skillId: string
  readonly root: 'ROOT' | 'USER'
  readonly name: string
  readonly version: string
  readonly enabled: boolean
  readonly loaded: boolean
  readonly tools: readonly string[]
  readonly source?: { readonly type: string; readonly locator: string }
}

/** Mirrors `ApplyResult` in `src/protocol.ts`. */
export interface ApplyResult {
  readonly skill_id: string
  readonly status: string
  readonly message: string
  readonly version?: string | null
}

/** Mirrors `HubContent` in `src/hub.ts`. */
export interface HubContent {
  readonly kind?: string
  readonly summary?: string
  readonly intro?: string
  readonly features?: readonly string[]
  readonly readme?: string | null
}

/** Mirrors `HubSkill` in `src/hub.ts`. */
export interface HubSkill {
  readonly skill_id: string
  readonly publisher?: string
  readonly display_name?: string
  readonly summary?: string
  readonly repository_url?: string
  readonly homepage_url?: string
  readonly license?: string
  readonly latest_version?: string
  readonly content?: HubContent | null
}

export interface HubPage {
  readonly hub: string
  readonly items: readonly HubSkill[]
  readonly nextCursor: string | null
}

export interface HubDetail {
  readonly hub: string
  readonly skill: HubSkill
  readonly original: HubContent | null
  readonly latest: { readonly version: string; readonly readme?: string; readonly published_at?: string }
}

export async function callHost<T>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${ROUTE_BASE}${route}`, {
    method,
    ...body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } },
  })
  const answer = await response.json().catch(() => undefined) as { ok?: boolean; value?: T; error?: { message?: string } } | undefined
  if (answer?.ok !== true) throw new Error(answer?.error?.message ?? `HTTP ${response.status}`)
  return answer.value as T
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Whether the runtime is on disk, whatever its engine is doing. */
export function isInstalled(state: RuntimeState): boolean {
  return state.kind === 'ready' || state.kind === 'starting' || (state.kind === 'failed' && state.installed)
}

/**
 * Latest-answer-wins view of one Host fact, shared by every rendered entry. `undefined` means
 * unknown: before the first answer, or after a failed read, so nothing is shown as a guess.
 */
export class HostWatch<T> {
  #value: T | undefined
  #listeners = new Set<() => void>()
  #generation = 0

  constructor(private readonly read: () => Promise<T | undefined>) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  readonly getSnapshot = (): T | undefined => this.#value

  /** Re-read the fact; an older answer never replaces a newer one. */
  refresh(): void {
    const generation = ++this.#generation
    this.read().then((value) => {
      if (generation === this.#generation) this.#set(value)
    }, () => {
      if (generation === this.#generation) this.#set(undefined)
    })
  }

  /** Stop publishing answers that are still in flight. */
  close(): void {
    ++this.#generation
    this.#listeners.clear()
  }

  #set(value: T | undefined): void {
    if (Object.is(value, this.#value)) return
    this.#value = value
    for (const listener of this.#listeners) listener()
  }
}
