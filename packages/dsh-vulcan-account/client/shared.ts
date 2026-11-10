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

/**
 * Start device sign-in for the selected site and request its authorization page. Resolves after
 * asking the browser or desktop shell to open it, and rejects if the sign-in request fails.
 * 为所选站点发起设备登录并请求打开授权页。向浏览器或桌面壳发出打开请求后完成，登录请求失败时拒绝。
 */
export async function startAccountSignIn(site: Site): Promise<void> {
  // A browser needs the click to open a tab before the asynchronous sign-in request.
  // 浏览器需要利用点击手势在异步登录请求之前打开标签页。
  const popup = window.open('about:blank', '_blank')
  try {
    // The account service validates the approval URL against the selected site and sign-in state.
    // 账号服务会根据所选站点和登录状态验证授权地址。
    const { approvalUrl } = await callAccount<{ approvalUrl: string }>('POST', `signin?site=${site}`)
    if (popup === null) {
      // dsh Desktop denies the blank tab and sends HTTP(S) URLs directly to the system browser.
      // dsh 桌面端拒绝空白标签页，并将 HTTP(S) 地址直接交给系统浏览器。
      window.open(approvalUrl, '_blank', 'noopener,noreferrer')
    } else if (!popup.closed) {
      popup.opener = null
      popup.location.replace(approvalUrl)
    }
  } catch (failure) {
    popup?.close()
    throw failure
  }
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
