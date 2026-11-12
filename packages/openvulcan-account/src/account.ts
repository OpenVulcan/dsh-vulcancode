/**
 * The OpenVulcan account of this device.
 *
 * Signing in is a PKCE (S256) flow with a loopback callback: the host opens the approval page in a
 * browser, the user approves, the browser is sent back to `http://127.0.0.1:<port>/vulcancode/auth/callback`
 * and the code is exchanged once for a device credential. The credential is an opaque token sent as
 * `Authorization: Auth <token>` to the site's own auth host only. It lasts 14 days and is rotated
 * by a single-use refresh once less than a day remains; a rotation that may have been interrupted
 * forces a fresh sign-in instead of guessing which token is current.
 *
 * Where the credential is kept is up to the host: dsh keeps it in its credential store, the command
 * line in an owner-only file. This module never logs or returns the token itself.
 */

import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import type { AddressInfo } from 'node:net'

/** The account cannot supply a usable credential: not signed in, expired, or the sign-in failed. */
export class AccountError extends Error {
  readonly code = 'not_signed_in'

  constructor(message: string) {
    super(message)
    this.name = 'AccountError'
  }
}

/** OpenVulcan deployments. The account's site is fixed when it signs in. */
export const SITES = {
  cn: { auth: 'https://auth.openvulcan.cn', api: 'https://api.openvulcan.cn' },
  global: { auth: 'https://auth.openvulcan.com', api: 'https://api.openvulcan.com' },
} as const
export type Site = keyof typeof SITES

export function isSite(value: unknown): value is Site {
  return value === 'cn' || value === 'global'
}

/** The stored device credential. */
export interface Credential {
  readonly site: Site
  /** Origin of the auth host, kept so tests can sign in against a local authority. */
  readonly auth_origin: string
  readonly access_token: string
  readonly authorization_id: string
  /** RFC 3339. */
  readonly expires_at: string
  /** Set while a refresh is in flight; still set afterwards means the rotation was interrupted. */
  readonly rotation_pending?: boolean
}

/** Where a host keeps the credential. */
export interface CredentialStore {
  read(): Promise<Credential | undefined>
  write(credential: Credential): Promise<void>
  delete(): Promise<void>
  /** Replace an exact record while holding the host's storage lock, when supported.
   *  宿主支持时，在持有存储锁的情况下替换完全匹配的记录。 */
  replace?(expected: Credential, next: Credential): Promise<boolean>
  /** Atomically clear and return the current credential, or only the exact expected record when supplied.
   *  原子清除并返回当前凭据。传入预期记录时，只清除完全匹配的记录。 */
  take?(expected?: Credential): Promise<Credential | undefined>
}

/** An owner-only JSON file, for the command line. */
export class FileCredentialStore implements CredentialStore {
  constructor(private readonly file: string) {}

  async read(): Promise<Credential | undefined> {
    try {
      return parseCredential(JSON.parse(fs.readFileSync(this.file, 'utf8')))
    } catch {
      return undefined
    }
  }

  async write(credential: Credential): Promise<void> {
    writeFileAtomic(this.file, `${JSON.stringify(credential, null, 2)}\n`)
  }

  async delete(): Promise<void> {
    fs.rmSync(this.file, { force: true })
  }
}

function writeFileAtomic(file: string, text: string): void {
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, text, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/** Accept a stored credential only when every field has its expected shape. */
export function parseCredential(value: unknown): Credential | undefined {
  const record = value as Partial<Credential> | null
  if (typeof record !== 'object' || record === null) return undefined
  if (!isSite(record.site) || typeof record.auth_origin !== 'string' || typeof record.access_token !== 'string'
    || typeof record.authorization_id !== 'string' || typeof record.expires_at !== 'string' || Number.isNaN(Date.parse(record.expires_at))) {
    return undefined
  }
  return {
    site: record.site, auth_origin: record.auth_origin, access_token: record.access_token,
    authorization_id: record.authorization_id, expires_at: record.expires_at,
    ...record.rotation_pending === true ? { rotation_pending: true } : {},
  }
}

/** Refresh once less than this remains. */
export const REFRESH_AHEAD_MS = 24 * 60 * 60_000
const CALLBACK_PATH = '/vulcancode/auth/callback'
const ACCESS_TOKEN = /^[A-Za-z0-9_-]{43}$/
const REQUEST_TIMEOUT_MS = 15_000

/** What the user sees about the device on the approval page. */
export interface DeviceInfo {
  readonly display_name: string
  readonly client_version: string
}

/** The account as a host shows it; never contains the token. */
export interface AccountStatus {
  readonly signedIn: boolean
  readonly site?: Site
  readonly authorizationId?: string
  readonly expiresAt?: string
  /** A refresh was interrupted; the user has to sign in again. */
  readonly reauthRequired?: boolean
}

/** A sign-in waiting for the user's approval. */
export interface PendingSignIn {
  readonly approvalUrl: string
  readonly expiresAt: string
  /** Settles when the user approved (the credential is stored) or the sign-in failed. */
  readonly done: Promise<AccountStatus>
  /** Stop waiting; a credential that already arrived is revoked. */
  cancel(): void
}

/** The signed-in user as OpenVulcan names them, and the plan in force. */
export interface AccountProfile {
  /** Decimal public user id, kept as a string. */
  readonly id: string
  readonly username: string
  readonly nickname: string
  /** The membership tier, or the free tier when not subscribed. */
  readonly plan: string
}

/** What a judge needs from an account: its state and a usable credential. */
export interface AccountSource {
  status(): Promise<AccountStatus>
  /** @throws AccountError when there is no usable credential. */
  credential(): Promise<Credential>
}

// Identify the credential whose server-side rotation this account currently owns.
// 标识当前账号实例正在进行服务端轮换的凭据。
interface ActiveRefresh {
  readonly credential: Credential
  readonly result: Promise<Credential>
}

/** Compare credential identities across reads while allowing the rotation marker to change.
 *  比较多次读取的凭据身份，允许轮换标记变化。 */
function sameCredential(left: Credential, right: Credential): boolean {
  return left.site === right.site && left.auth_origin === right.auth_origin
    && left.authorization_id === right.authorization_id && left.access_token === right.access_token
    && left.expires_at === right.expires_at
}

/** Match a persisted credential including its rotation marker.
 *  比较持久化凭据，包含轮换标记。 */
export function matchesStoredCredential(current: Credential | undefined, expected: Credential): boolean {
  return current !== undefined && sameCredential(current, expected)
    && (current.rotation_pending === true) === (expected.rotation_pending === true)
}

export class OpenVulcanAccount implements AccountSource {
  // Track live work separately from the durable crash-recovery marker.
  // 将正在进行的刷新与持久化的崩溃恢复标记分开记录。
  private refreshing: ActiveRefresh | undefined
  // A sign-out fences outstanding callers immediately and waits for any credential writes it supersedes.
  // 退出登录立即隔离进行中的调用，并等待它所取代的凭据写入。
  private signOutGeneration = 0
  private signingOut: Promise<void> | undefined
  private readonly signInWrites = new Set<Promise<void>>()

  constructor(
    private readonly store: CredentialStore,
    private readonly device: DeviceInfo,
    /** Overrides the auth origin of every site; tests point it at a local authority. */
    private readonly authOrigin?: string,
  ) {}

  async status(): Promise<AccountStatus> {
    const generation = this.signOutGeneration
    if (this.signingOut !== undefined) return { signedIn: false }
    const credential = await this.store.read()
    if (credential === undefined || !this.isCurrent(generation)) return { signedIn: false }
    const interrupted = credential.rotation_pending === true && this.refreshFor(credential) === undefined
    return {
      signedIn: !interrupted && (this.refreshFor(credential) !== undefined || Date.parse(credential.expires_at) > Date.now()),
      site: credential.site,
      authorizationId: credential.authorization_id,
      expiresAt: credential.expires_at,
      ...interrupted ? { reauthRequired: true } : {},
    }
  }

  /** Begin signing in to `site`. */
  async signIn(site: Site): Promise<PendingSignIn> {
    const generation = this.signOutGeneration
    this.assertCurrent(generation)
    const origin = this.authOrigin ?? SITES[site].auth
    const state = base64url(randomBytes(32))
    const verifier = base64url(randomBytes(32))
    const challenge = base64url(createHash('sha256').update(verifier).digest())

    let settle!: { resolve: (code: string) => void; reject: (error: Error) => void }
    const callback = new Promise<string>((resolve, reject) => {
      settle = { resolve, reject }
    })
    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const keys = [...url.searchParams.keys()].sort()
      if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH || keys.join(',') !== 'code,state' || url.searchParams.get('state') !== state) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Invalid sign-in callback.')
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end('<!doctype html><meta charset="utf-8"><title>Vulcan Decision</title><p>Signed in. You can close this page.</p>')
      settle.resolve(url.searchParams.get('code') ?? '')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const port = (server.address() as AddressInfo).port
    const close = () => server.close()

    let begin: { request_id: string; approval_url: string; expires_at: string }
    try {
      begin = await postJson(`${origin}/api/v1/vulcancode/authorize`, undefined, {
        callback_uri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        device: {
          display_name: this.device.display_name.slice(0, 64),
          operating_system: operatingSystem(),
          architecture: architecture(),
          client_version: this.device.client_version.slice(0, 32),
        },
      }) as typeof begin
      checkApprovalUrl(begin.approval_url, origin, state)
      this.assertCurrent(generation)
    } catch (error) {
      close()
      throw error
    }

    let cancelled = false
    const timeout = setTimeout(() => settle.reject(new AccountError('the sign-in request expired')),
      Math.max(0, Date.parse(begin.expires_at) - Date.now()) || 600_000)
    const done = (async (): Promise<AccountStatus> => {
      try {
        const code = await callback
        const answer = await postJson(`${origin}/api/v1/vulcancode/token`, undefined, { code, code_verifier: verifier })
        const credential = tokenAnswer(answer, site, origin)
        if (cancelled || !this.isCurrent(generation)) {
          await revoke(credential)
          throw new AccountError('the sign-in was cancelled')
        }
        const write = this.store.write(credential)
        this.signInWrites.add(write)
        try { await write } finally { this.signInWrites.delete(write) }
        this.assertCurrent(generation)
        const status = await this.status()
        this.assertCurrent(generation)
        if (!cancelled) return status
        // A cancellation during persistence must retire only the credential from this attempt.
        // 持久化期间的取消只应清理本次尝试产生的凭据。
        try { await this.take(credential) } finally { await revoke(credential) }
        throw new AccountError('the sign-in was cancelled')
      } finally {
        clearTimeout(timeout)
        close()
      }
    })()
    done.catch(() => {})
    return {
      approvalUrl: begin.approval_url,
      expiresAt: begin.expires_at,
      done,
      cancel: () => {
        cancelled = true
        settle.reject(new AccountError('the sign-in was cancelled'))
      },
    }
  }

  /**
   * Who is signed in, read from `GET /api/v1/vulcancode/account`; an answer for another device
   * authorization is refused.
   * @throws AccountError when nobody is signed in or the answer breaks the contract.
   */
  async profile(): Promise<AccountProfile> {
    const credential = await this.credential()
    const answer = await requestJson(`${credential.auth_origin}/api/v1/vulcancode/account`, credential.access_token, { method: 'GET' }) as {
      authorization_id?: unknown
      user?: { id?: unknown; username?: unknown; nickname?: unknown }
      quota?: { free?: { tier?: unknown }; member?: { tier?: unknown } | null }
    }
    const user = answer?.user
    const tier = answer?.quota?.member?.tier ?? answer?.quota?.free?.tier
    if (typeof user?.id !== 'string' || typeof user.username !== 'string' || typeof user.nickname !== 'string' || typeof tier !== 'string') {
      throw new AccountError('OpenVulcan answered a malformed account')
    }
    if (answer.authorization_id !== credential.authorization_id) throw new AccountError('OpenVulcan answered the account of another device authorization')
    return { id: user.id, username: user.username, nickname: user.nickname, plan: tier }
  }

  /** Revoke the credential on the server and forget it here. */
  async signOut(): Promise<void> {
    if (this.signingOut === undefined) {
      this.signOutGeneration++
      const writes = [...this.signInWrites]
      const rotation = this.refreshing
      this.signingOut = (async () => {
        // The old token may already be invalid. Revoke the token returned by the completed rotation.
        // 旧令牌可能已失效，因此等待轮换结束后注销其返回的新令牌。
        const [rotated] = await Promise.all([rotation?.result.catch(() => undefined), Promise.allSettled(writes)])
        const stored = await this.take()
        if (rotated !== undefined) await revoke(rotated)
        if (stored !== undefined && (rotated === undefined || stored.authorization_id !== rotated.authorization_id
          || stored.auth_origin !== rotated.auth_origin)) await revoke(stored)
      })().finally(() => { this.signingOut = undefined })
    }
    await this.signingOut
  }

  /**
   * A usable credential, refreshed first when less than a day remains.
   * @throws AccountError when there is none or it can no longer be trusted.
   */
  async credential(): Promise<Credential> {
    const generation = this.signOutGeneration
    this.assertCurrent(generation)
    const credential = await this.store.read()
    this.assertCurrent(generation)
    if (credential === undefined) throw new AccountError('not signed in to OpenVulcan')
    const active = this.refreshFor(credential)
    if (active !== undefined) return await this.awaitCredential(active.result, generation)
    if (credential.rotation_pending === true) throw new AccountError('a credential rotation was interrupted; sign in to OpenVulcan again')
    const remaining = Date.parse(credential.expires_at) - Date.now()
    if (remaining <= 0) throw new AccountError('the OpenVulcan sign-in expired; sign in again')
    if (remaining > REFRESH_AHEAD_MS) return credential
    const result = Promise.resolve().then(() => this.refresh(credential)).finally(() => {
      if (this.refreshing?.result === result) this.refreshing = undefined
    })
    this.refreshing = { credential, result }
    return await this.awaitCredential(result, generation)
  }

  /** Return the live rotation only if it belongs to the credential just read.
   *  仅当正在进行的轮换属于刚读取的凭据时返回该任务。 */
  private refreshFor(credential: Credential): ActiveRefresh | undefined {
    return this.refreshing !== undefined && sameCredential(this.refreshing.credential, credential) ? this.refreshing : undefined
  }

  /** Check whether an operation still belongs to the current sign-out generation.
   *  检查操作是否仍属于当前的退出登录代次。 */
  private isCurrent(generation: number): boolean {
    return this.signingOut === undefined && generation === this.signOutGeneration
  }

  /** Refuse credential delivery after sign-out has superseded the operation.
   *  退出登录取代操作后，拒绝交付凭据。 */
  private assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) throw new AccountError('the OpenVulcan account is signing out or has signed out')
  }

  /** Wait for rotation, then recheck whether the caller may still receive the token.
   *  等待轮换，然后复查调用方是否仍可获得令牌。 */
  private async awaitCredential(result: Promise<Credential>, generation: number): Promise<Credential> {
    const credential = await result
    this.assertCurrent(generation)
    return credential
  }

  /** Update the expected credential, using the host's atomic comparison where available.
   *  更新预期凭据，在宿主支持时使用原子比较。 */
  private async replace(expected: Credential, next: Credential): Promise<boolean> {
    if (this.store.replace !== undefined) return this.store.replace(expected, next)
    if (!matchesStoredCredential(await this.store.read(), expected)) return false
    await this.store.write(next)
    return true
  }

  /** Remove the stored token and return the value this operation actually cleared.
   *  清除存储中的令牌，并返回本次操作实际清除的凭据。 */
  private async take(expected?: Credential): Promise<Credential | undefined> {
    if (this.store.take !== undefined) return this.store.take(expected)
    const stored = await this.store.read()
    if (stored === undefined || (expected !== undefined && !matchesStoredCredential(stored, expected))) return undefined
    await this.store.delete()
    return stored
  }

  private async refresh(credential: Credential): Promise<Credential> {
    const pending = { ...credential, rotation_pending: true }
    if (!await this.replace(credential, pending)) throw new AccountError('the OpenVulcan credential changed before refresh')
    let answer: unknown
    try {
      answer = await postJson(`${credential.auth_origin}/api/v1/vulcancode/token/refresh`, credential.access_token, {})
    } catch (error) {
      // A refusal means the credential is gone; anything else leaves the rotation pending.
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) await this.take(pending)
      throw new AccountError(`refreshing the OpenVulcan sign-in failed: ${(error as Error).message}`)
    }
    const next = tokenAnswer(answer, credential.site, credential.auth_origin)
    if (next.authorization_id !== credential.authorization_id) {
      await this.take(pending)
      throw new AccountError('the refreshed credential belongs to another device authorization')
    }
    // Give an overlapping sign-out the rotated token directly without writing it back.
    // 与退出登录重叠时，直接交付轮换后的令牌用于注销，避免再次保存。
    if (this.signingOut !== undefined && this.refreshing?.credential === credential) return next
    try {
      if (await this.replace(pending, next)) return next
      throw new AccountError('the OpenVulcan credential changed during refresh')
    } catch (error) {
      // The server has already issued the token. Storage failure also leaves it without a local owner.
      // 服务端已签发令牌。存储操作抛出异常时，新令牌同样没有可靠的本地归属。
      try {
        await revoke(next)
      } catch (revocationError) {
        throw new AggregateError([error, revocationError], 'The refreshed OpenVulcan credential could not be saved or revoked.')
      }
      throw error
    }
  }
}

async function revoke(credential: Credential): Promise<void> {
  try {
    await postJson(`${credential.auth_origin}/api/v1/vulcancode/logout`, credential.access_token, {})
  } catch (error) {
    // An already invalid credential is as good as revoked.
    if (!(error instanceof HttpError && error.status === 401)) throw error
  }
}

function tokenAnswer(value: unknown, site: Site, origin: string): Credential {
  const answer = value as { access_token?: unknown; token_type?: unknown; expires_at?: unknown; authorization_id?: unknown; site?: unknown }
  if (typeof answer?.access_token !== 'string' || !ACCESS_TOKEN.test(answer.access_token) || answer.token_type !== 'Auth'
    || typeof answer.expires_at !== 'string' || Number.isNaN(Date.parse(answer.expires_at))
    || typeof answer.authorization_id !== 'string' || answer.authorization_id === '') {
    throw new AccountError('OpenVulcan answered a malformed credential')
  }
  if (answer.site !== undefined && answer.site !== site) throw new AccountError('OpenVulcan answered for another site')
  return { site, auth_origin: origin, access_token: answer.access_token, authorization_id: answer.authorization_id, expires_at: answer.expires_at }
}

function checkApprovalUrl(value: unknown, origin: string, state: string): void {
  if (typeof value !== 'string') throw new AccountError('OpenVulcan answered no approval page')
  const url = new URL(value)
  const keys = [...url.searchParams.keys()].sort().join(',')
  if (url.origin !== origin || url.pathname !== '/authorize' || keys !== 'request_id,state' || url.searchParams.get('state') !== state) {
    throw new AccountError('OpenVulcan answered an unexpected approval page')
  }
}

/** An HTTP answer outside 2xx. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string | undefined, message: string, readonly retryAfterMs?: number) {
    super(message)
    this.name = 'HttpError'
  }
}

/** POST JSON, with `Authorization: Auth <token>` when a token is given. */
export async function postJson(url: string, token: string | undefined, body: unknown): Promise<unknown> {
  return await requestJson(url, token, { method: 'POST', body: JSON.stringify(body) })
}

export async function requestJson(url: string, token: string | undefined, init: { method: string; body?: string }): Promise<unknown> {
  const response = await fetch(url, {
    method: init.method,
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      'Accept': 'application/json',
      ...init.body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...token === undefined ? {} : { Authorization: `Auth ${token}` },
    },
    ...init.body === undefined ? {} : { body: init.body },
  })
  const text = await response.text()
  if (!response.ok) {
    let code: string | undefined
    let message = `HTTP ${response.status}`
    try {
      const envelope = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } | string; message?: unknown }
      if (typeof envelope.error === 'object' && envelope.error !== null) {
        code = typeof envelope.error.code === 'string' ? envelope.error.code : undefined
        if (typeof envelope.error.message === 'string') message += `: ${envelope.error.message}`
      } else if (typeof envelope.error === 'string') {
        code = envelope.error
        if (typeof envelope.message === 'string') message += `: ${envelope.message}`
      }
    } catch {
      // A non-JSON error body carries nothing more.
    }
    throw new HttpError(response.status, code, code === undefined ? message : `${message} (${code})`, retryAfter(response.headers.get('Retry-After')))
  }
  return text === '' ? {} : JSON.parse(text)
}

export function retryAfter(header: string | null): number | undefined {
  if (header === null) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(header)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url')
}

function operatingSystem(): string {
  const name = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform as string] ?? process.platform
  return `${name} ${os.release()}`.slice(0, 64)
}

function architecture(): string {
  return process.arch === 'arm64' ? 'arm64' : 'x86_64'
}
