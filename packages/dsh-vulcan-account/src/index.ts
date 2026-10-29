/**
 * The OpenVulcan account for every VulcanCode plugin in dsh: one sign-in, kept in dsh's credential
 * store and refreshed here, offered to other plugins as the cordis service `openvulcanAccount`.
 * The settings page signs in and out through exact `/api/vulcan-account/*` routes inside dsh's
 * authenticated connection.
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-client-connection'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import {
  AccountError, isSite, OpenVulcanAccount, parseCredential,
  type AccountProfile, type AccountSource, type AccountStatus, type Credential, type CredentialStore, type PendingSignIn, type Site,
} from '@openvulcan/openvulcan-account'

export type { AccountProfile, AccountStatus, Credential, PendingSignIn, Site } from '@openvulcan/openvulcan-account'

declare module '@deepseek-ai/cordis' {
  interface Context {
    openvulcanAccount: OpenVulcanAccountService
  }
}

/** Where the credential is kept in dsh's credential store; only this plugin reads or writes it. */
export const CREDENTIAL_KEY = credentialKey('openvulcan', 'account')

/** Prefix of every settings route, below dsh's `/api`. Also restated in `client/shared.ts`. */
export const ROUTE_PREFIX = '/api/vulcan-account/'

/** A sign-in the settings page started and is waiting on, as the page shows it. */
export interface SignInView {
  readonly approvalUrl: string
  readonly expiresAt: string
}

/** Everything the settings page shows, in one answer. */
export interface AccountView {
  readonly account: AccountStatus
  readonly signIn: SignInView | null
  readonly signInError?: string
}

/**
 * How OpenVulcan records this sign-in: the client is dsh at its exact running version, so the
 * platform can count dsh installations the way it counts "Vulcan Code".
 */
export function deviceInfo(dshVersion: string) {
  return { display_name: 'dsh', client_version: dshVersion }
}

/** The account credential as one dsh grant record. */
export class DshCredentialStore implements CredentialStore {
  constructor(private readonly ctx: Context) {}

  async read(): Promise<Credential | undefined> {
    const record = await this.ctx.credentials.readRecord(CREDENTIAL_KEY)
    return record?.kind === 'grant' ? parseCredential(record.payload) : undefined
  }

  async write(credential: Credential): Promise<void> {
    await this.ctx.credentials.modifyRecord(CREDENTIAL_KEY, async () => ({ kind: 'grant', payload: credential }))
  }

  async delete(): Promise<void> {
    await this.ctx.credentials.deleteRecord(CREDENTIAL_KEY)
  }
}

/**
 * The OpenVulcan account other plugins use. A consumer looks it up with
 * `ctx.get('openvulcanAccount')` on every use rather than injecting it, so turning this plugin off
 * makes cloud features fail as "not signed in" instead of silently stopping the consumer.
 */
export class OpenVulcanAccountService extends Service implements AccountSource {
  static inject = ['credentials']

  private readonly account: OpenVulcanAccount
  private readonly listeners = new Set<(status: AccountStatus) => void>()
  private pending: PendingSignIn | undefined
  private pendingError: string | undefined
  /** The profile of one device authorization, read once per sign-in. */
  private profileCache: { readonly authorizationId: string; readonly profile: Promise<AccountProfile> } | undefined

  constructor(ctx: Context) {
    super(ctx, 'openvulcanAccount')
    // Tests point sign-in at a local stand-in.
    this.account = new OpenVulcanAccount(new DshCredentialStore(ctx), deviceInfo(getDshRuntimeVersion()), process.env['OPENVULCAN_AUTH_ORIGIN'])

    // The settings routes live inside dsh's authenticated connection, when there is one.
    ctx.inject(['connection'], (child) => {
      for (const [method, route, handler] of ROUTES) {
        child.effect(() => child.connection.fetch.register({
          path: `${ROUTE_PREFIX}${route}`,
          methods: [method],
          requestBody: 'buffered',
          fetch: request => handle(this, handler, request),
        }))
      }
    })
    ctx.effect(() => () => {
      this.pending?.cancel()
      this.pending = undefined
      this.listeners.clear()
    }, 'openvulcan-account: pending sign-in')
  }

  /** The account as hosts show it; never contains the token. */
  async status(): Promise<AccountStatus> {
    return await this.account.status()
  }

  /**
   * A usable credential, refreshed first when it is about to expire.
   * @throws AccountError when nobody is signed in or the user has to sign in again.
   */
  async credential(): Promise<Credential> {
    return await this.account.credential()
  }

  /**
   * Start signing in at `site`; any sign-in still waiting is cancelled. `done` settles once the
   * user approved (the credential is stored) or the sign-in failed.
   */
  async signIn(site: Site): Promise<PendingSignIn> {
    this.cancelSignIn()
    const pending = await this.account.signIn(site)
    this.pending = pending
    pending.done.then(async (status) => {
      this.notify(status)
    }, (error: unknown) => {
      if (this.pending === pending) this.pendingError = messageOf(error)
    }).finally(() => {
      if (this.pending === pending) this.pending = undefined
    })
    return pending
  }

  cancelSignIn(): void {
    this.pending?.cancel()
    this.pending = undefined
    this.pendingError = undefined
  }

  /** Revoke this device at OpenVulcan and forget the credential. */
  async signOut(): Promise<void> {
    this.cancelSignIn()
    try {
      await this.account.signOut()
    } finally {
      this.notify(await this.account.status())
    }
  }

  /**
   * Who is signed in, read from OpenVulcan once per device authorization; a failed read is not kept.
   * @throws AccountError when nobody is signed in.
   */
  async profile(): Promise<AccountProfile> {
    const status = await this.account.status()
    if (!status.signedIn || status.authorizationId === undefined) throw new AccountError('not signed in to OpenVulcan')
    if (this.profileCache?.authorizationId !== status.authorizationId) {
      const cache = { authorizationId: status.authorizationId, profile: this.account.profile() }
      this.profileCache = cache
      cache.profile.catch(() => {
        if (this.profileCache === cache) this.profileCache = undefined
      })
    }
    return await this.profileCache.profile
  }

  /** Called after every sign-in and sign-out; returns the unsubscribe function. */
  onChange(listener: (status: AccountStatus) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** The settings page's view. */
  async view(): Promise<AccountView> {
    return {
      account: await this.account.status(),
      signIn: this.pending === undefined ? null : { approvalUrl: this.pending.approvalUrl, expiresAt: this.pending.expiresAt },
      ...this.pendingError === undefined ? {} : { signInError: this.pendingError },
    }
  }

  private notify(status: AccountStatus): void {
    this.profileCache = undefined
    for (const listener of this.listeners) {
      try {
        listener(status)
      } catch (error) {
        this.ctx.logger.warn(`an account listener failed: ${messageOf(error)}`)
      }
    }
  }
}

/** Fetch-shaped handler of one settings route. */
type Handler = (account: OpenVulcanAccountService, request: Request, url: URL) => Promise<unknown>

/** A request the page should not have sent. */
class RequestError extends Error {
  readonly code = 'invalid_request'
}

/** Every settings route: method, path below {@link ROUTE_PREFIX}, handler. */
export const ROUTES: readonly (readonly ['GET' | 'POST', string, Handler])[] = [
  ['GET', 'state', account => account.view()],
  ['GET', 'profile', account => account.profile()],
  ['POST', 'signin', async (account, _request, url) => {
    const site = url.searchParams.get('site')
    if (!isSite(site)) throw new RequestError('site must be cn or global')
    const pending = await account.signIn(site)
    return { approvalUrl: pending.approvalUrl }
  }],
  ['POST', 'signin/cancel', async account => account.cancelSignIn()],
  ['POST', 'signout', account => account.signOut()],
]

/** Answer one settings request; failures carry their code, never a stack. */
export async function handle(account: OpenVulcanAccountService, handler: Handler, request: Request): Promise<Response> {
  try {
    const value = await handler(account, request, new URL(request.url))
    return Response.json({ ok: true, value: value ?? null }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    const code = error instanceof AccountError || error instanceof RequestError ? error.code : 'failed'
    const status = code === 'invalid_request' ? 400 : code === 'not_signed_in' ? 401 : 500
    return Response.json({ ok: false, error: { code, message: messageOf(error) } }, { status, headers: { 'cache-control': 'no-store' } })
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default OpenVulcanAccountService
