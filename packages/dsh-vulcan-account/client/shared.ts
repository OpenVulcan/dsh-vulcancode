/** Facts the browser half shares with the Host half. */

/** Checked against `package.json` by `scripts/bundle-client.mjs`. */
export const PACKAGE_NAME = '@openvulcan/dsh-vulcan-account'
/** The Settings dialog entry this plugin adds; other VulcanCode plugins open it by this id. */
export const SETTINGS_SECTION = 'vulcan-account'
/** The bundle the Plugins page lists; its page summary is this plugin's. */
export const SUITE_PACKAGE = '@openvulcan/dsh-vulcancode'
/** The decision guard's Settings dialog entry. */
export const GUARD_SECTION = 'vulcan-auto-approval'
/** Mirrors `ROUTE_PREFIX` in `src/index.ts`, below the page's origin. */
const ROUTE_BASE = '/api/vulcan-account/'

/** The two OpenVulcan sites, in the order they are offered. */
export const SITES = [
  { site: 'global', domain: 'openvulcan.com' },
  { site: 'cn', domain: 'openvulcan.cn' },
] as const
export type Site = (typeof SITES)[number]['site']

/** Mirrors `AccountView` in `src/index.ts`. */
export interface AccountView {
  readonly account: {
    readonly signedIn: boolean
    readonly site?: Site
    readonly authorizationId?: string
    readonly expiresAt?: string
    readonly reauthRequired?: boolean
  }
  readonly signIn: { readonly approvalUrl: string; readonly expiresAt: string } | null
  readonly signInError?: string
}

/** Mirrors `AccountProfile` in `@openvulcan/openvulcan-account`. */
export interface AccountProfile {
  readonly id: string
  readonly username: string
  readonly nickname: string
  readonly plan: string
}

export async function callAccount<T>(method: 'GET' | 'POST', route: string): Promise<T> {
  const response = await fetch(`${ROUTE_BASE}${route}`, { method })
  const answer = await response.json().catch(() => undefined) as { ok?: boolean; value?: T; error?: { message?: string } } | undefined
  if (answer?.ok !== true) throw new Error(answer?.error?.message ?? `HTTP ${response.status}`)
  return answer.value as T
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
