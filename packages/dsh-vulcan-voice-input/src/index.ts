import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { OpenVulcanAccountService } from '@openvulcan/dsh-vulcan-account'
import type { Credential } from '@openvulcan/openvulcan-account'
import { getPublication, MAX_AUDIO_BYTES, MAX_SECONDS, readBounded, transcribe, validateWav, VoiceFailure, type Publication } from './cloud.js'
import type { VoiceReply, VoiceState } from './contract.js'

// Cordis entry identity and owner-only routes used by the browser contribution.
// Cordis 条目标识与浏览器扩展使用的仅限所有者路由。
export const name = 'vulcan-voice-input'
const BASE = '/api/vulcan-voice-input/'
// Status reads can reuse a recent directory; actual transcription always refreshes it.
// 状态查询可复用近期目录，实际转写每次都重新读取目录。
const CATALOG_TTL_MS = 60_000

/**
 * The identity captured before an async operation, with its cancellation generation.
 * 异步操作开始前捕获的账号身份及其取消信号。
 */
interface AccountBinding {
  readonly account: Pick<OpenVulcanAccountService, 'status' | 'credential'>
  readonly site: Credential['site']
  readonly id: string
  readonly signal: AbortSignal
}

/**
 * Encode an owner-only response without allowing it to enter an HTTP cache.
 * 编码仅限所有者的响应，并禁止 HTTP 缓存。
 */
function json(body: VoiceState | VoiceReply, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

/**
 * Drain a rejected, length-bounded browser upload without retaining audio so dsh can flush the error.
 * 丢弃长度有界的浏览器上传且不保留音频，让 dsh 能完整返回错误。
 */
async function discardRejectedUpload(request: Request): Promise<void> {
  const length = request.headers.get('content-length')
  if (request.body === null || request.bodyUsed || length === null || !/^\d+$/.test(length) ||
      Number(length) > MAX_AUDIO_BYTES) return
  // dsh closes an unread streaming request. A known-length HTTP body cannot exceed its framing length.
  // dsh 会关闭未读完的流式请求。已知长度的 HTTP 正文不会超过其分帧长度。
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(3000)])
  await request.body.pipeTo(new WritableStream(), { signal }).catch(() => {})
}

/**
 * Gate the free microphone channel on the active OpenVulcan device authorization.
 * 仅允许当前有效的 OpenVulcan 设备授权使用免费麦克风通道。
 */
export class VoiceInput {
  // An account change invalidates cached readiness and cancels upstream work.
  // 账号变化会清除缓存的可用状态并取消上游任务。
  #epoch = new AbortController()
  #catalog: { readonly id: string; readonly site: Credential['site']; readonly expires: number; readonly publication: Publication } | undefined
  #uploading = false

  /**
   * Read the active account from its owning Cordis service and use the supplied native transport.
   * 从所属 Cordis 服务读取当前账号，并使用指定的原生传输实现。
   */
  constructor(private readonly getAccount: () => AccountBinding['account'] | undefined, private readonly transport = fetch) {}

  /**
   * Discard readiness and cancel work associated with the previous device authorization.
   * 清除可用状态并取消上一次设备授权所属的任务。
   */
  accountChanged(): void {
    this.#catalog = undefined
    this.#epoch.abort()
    this.#epoch = new AbortController()
  }

  /**
   * Report login, regional publication and the default model. Refresh is an explicit settings action.
   * 返回登录状态、区域服务和默认模型。立即刷新由设置页显式触发。
   */
  async status(request: Request): Promise<Response> {
    try {
      const binding = await this.#binding()
      const cached = this.#catalog
      let publication: Publication
      if (new URL(request.url).searchParams.get('refresh') !== '1' &&
          cached !== undefined && cached.id === binding.id && cached.site === binding.site && cached.expires > Date.now()) {
        publication = cached.publication
      } else {
        const credential = await this.#credential(binding)
        publication = await getPublication(this.transport, credential, AbortSignal.any([binding.signal, request.signal]))
        await this.#confirm(binding)
        this.#catalog = { id: binding.id, site: binding.site, expires: Date.now() + CATALOG_TTL_MS, publication }
      }
      return publication === null ? json({ status: 'disabled', site: binding.site }) : json({
        status: 'ready', site: binding.site, authorizationId: binding.id, catalog: publication, maxSeconds: MAX_SECONDS,
      })
    } catch (error) {
      return json({ status: error instanceof VoiceFailure && error.code === 'signed_out' ? 'signed_out' : 'unavailable' })
    }
  }

  /**
   * Validate, submit and return one recording. Only one bounded upload is read at a time.
   * 校验并提交一段录音，同一时刻只读取一份有界上传。
   */
  async upload(request: Request): Promise<Response> {
    let ownsUpload = false
    try {
      const binding = await this.#binding()
      if (request.headers.get('x-vulcan-voice-authorization') !== binding.id) throw new VoiceFailure('signed_out', 401)
      if (request.headers.get('content-type') !== 'audio/wav' || request.headers.has('content-encoding')) {
        throw new VoiceFailure('invalid_audio', 415)
      }
      if (this.#uploading) throw new VoiceFailure('busy', 503)
      this.#uploading = ownsUpload = true
      const signal = AbortSignal.any([binding.signal, request.signal, AbortSignal.timeout(80_000)])
      const wav = await readBounded(request, MAX_AUDIO_BYTES, new VoiceFailure('invalid_audio', 413), signal)
      validateWav(wav)
      const credential = await this.#credential(binding)
      const publication = await getPublication(this.transport, credential, signal)
      await this.#confirm(binding)
      if (publication === null) throw new VoiceFailure('unavailable', 503)
      // Validate the recording's frozen selection against the account's current regional catalog.
      // 对照该账号的当前站点目录，验证录音开始时冻结的选项。
      const modelId = request.headers.get('x-vulcan-voice-model') ?? publication.defaultModelId
      const language = request.headers.get('x-vulcan-asr-language')
      const model = publication.models.find(entry => entry.id === modelId)
      if (model === undefined || (language !== null && !model.languages.includes(language))) {
        throw new VoiceFailure('selection_unavailable', 409)
      }
      const text = await transcribe(this.transport, credential, signal, {
        modelId, ...(language === null ? {} : { language }),
      }, wav)
      await this.#confirm(binding)
      return json({ ok: true, text })
    } catch (error) {
      await discardRejectedUpload(request)
      const failure = error instanceof VoiceFailure ? error : new VoiceFailure('unavailable', 502)
      return json({
        ok: false, code: failure.code,
        ...(failure.retryAfter === undefined ? {} : { retryAfter: failure.retryAfter }),
      }, failure.status)
    } finally {
      if (ownsUpload) this.#uploading = false
    }
  }

  /**
   * Capture the current account and its verified local authorization state.
   * 捕获当前账号服务及已校验的本地设备授权状态。
   */
  async #binding(): Promise<AccountBinding> {
    const signal = this.#epoch.signal
    const account = this.getAccount()
    if (account === undefined) throw new VoiceFailure('signed_out', 401)
    const status = await account.status()
    if (signal.aborted || this.getAccount() !== account || !status.signedIn || status.reauthRequired ||
        status.site === undefined || status.authorizationId === undefined) throw new VoiceFailure('signed_out', 401)
    return { account, id: status.authorizationId, site: status.site, signal }
  }

  /**
   * Recheck the account after awaits so work cannot move to a new authorization.
   * 在异步等待后复核账号，防止任务跨设备授权继续执行。
   */
  async #confirm(binding: AccountBinding): Promise<void> {
    const current = await this.#binding()
    if (binding.signal.aborted || binding.account !== current.account || binding.id !== current.id ||
        binding.site !== current.site) throw new VoiceFailure('signed_out', 401)
  }

  /**
   * Refresh a native credential through the account service and verify its owner.
   * 通过账号服务刷新原生凭据，并验证其归属。
   */
  async #credential(binding: AccountBinding): Promise<Credential> {
    const credential = await binding.account.credential().catch(() => { throw new VoiceFailure('signed_out', 401) })
    await this.#confirm(binding)
    if (credential.authorization_id !== binding.id || credential.site !== binding.site) {
      throw new VoiceFailure('signed_out', 401)
    }
    return credential
  }
}

/**
 * Install the settings and audio routes within dsh's authenticated owner connection.
 * 在 dsh 已认证的所有者连接内挂载设置与音频路由。
 */
export function apply(ctx: Context): void {
  // Cordis wraps services on each lookup, so capture one proxy for each injection lifetime.
  // Cordis 每次查找都会包装服务，因此在每次注入的生命周期内复用同一个代理。
  let account: OpenVulcanAccountService | undefined
  const voice = new VoiceInput(() => account)
  ctx.inject(['openvulcanAccount'], child => {
    child.effect(() => {
      const activeAccount = child.openvulcanAccount
      const stop = activeAccount.onChange(() => voice.accountChanged())
      account = activeAccount
      return () => {
        account = undefined
        stop()
        voice.accountChanged()
      }
    }, 'vulcan-voice-input: account')
  })
  ctx.inject(['connection'], child => {
    child.effect(() => child.connection.fetch.register({
      path: `${BASE}state`, methods: ['GET'], requestBody: 'buffered', fetch: request => voice.status(request),
    }), 'vulcan-voice-input: state')
    child.effect(() => child.connection.fetch.register({
      path: `${BASE}transcriptions`, methods: ['POST'], requestBody: 'streaming', fetch: request => voice.upload(request),
    }), 'vulcan-voice-input: transcriptions')
  })
}
