import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { AccountSource } from '@openvulcan/openvulcan-account'
import { z } from 'zod'
import { MemoryError } from '../markdown/errors.js'
import { fingerprint, MemoryCloud, sameConsent, type CloudOffer } from './cloud.js'
import { installNative, libraryPath, nativeStatus, NATIVE_VERSION } from './native-install.js'
import type { VectorRequest } from './native-worker.js'
import { SqliteStore, type Consent, type RecordEntry } from './store.js'

// Parse the native child's bounded reply without loading Koffi in the dsh process.
// 解析原生子进程的有限响应，避免在 dsh 主进程中加载 Koffi。
const hitsSchema = z.object({ hits: z.array(z.object({ id: z.uuid(), revision: z.uuid() })).max(24) })

// Bind one inference operation to the grant revision checked before its first cloud request.
// 将一次推理操作绑定到首个云端请求前校验的授权版本。
interface ApprovedOffer {
  readonly offer: CloudOffer
  readonly revision: string
}

/** Manage one SQLite mode instance, including consent-gated access to the free cloud service.
 *  管理一个 SQLite 模式实例，以及经用户同意的免费云端服务访问。 */
export class StructuredMemory {
  // Keep a single lazy database, active download and cancellation source per plugin instance.
  // 每个插件实例共用一个延迟打开的数据库、下载任务和取消信号。
  private store: Promise<SqliteStore> | undefined
  private download: Promise<void> | undefined
  private lifetime = new AbortController()
  private cloud: MemoryCloud

  /** Receive the private data root and functions for checking current mode and account.
   *  接收私有数据根目录，以及查询当前模式和账号的函数。 */
  constructor(private root: string, private enabled: () => boolean, account: () => AccountSource | undefined) {
    this.cloud = new MemoryCloud(account)
  }

  /** Close database resources and cancel child operations on plugin unload.
   *  插件卸载时关闭数据库并取消子进程任务。 */
  dispose(): void {
    this.lifetime.abort()
    void this.store?.then(store => { store.close() }, () => {})
  }

  /** Get the lazy SQLite store while the mode remains selected.
   *  在当前仍选择 SQLite 模式时获取延迟打开的数据库。 */
  async local(): Promise<SqliteStore> {
    this.assertEnabled()
    this.store ??= SqliteStore.open(this.root).catch((error: unknown) => {
      this.store = undefined
      throw error
    })
    const store = await this.store
    this.assertEnabled()
    return store
  }

  /** Return installed native status and the free offer's approval state.
   *  返回原生库安装状态和免费方案的同意状态。 */
  async status() {
    const store = await this.local()
    let cloudError = false
    const [native, offer] = await Promise.all([
      nativeStatus(this.root), this.cloud.offer().catch(() => { cloudError = true; return null }),
    ])
    this.assertEnabled()
    const { grant } = store.consent()
    return { native, version: NATIVE_VERSION, offer, cloudError,
      approved: offer !== null && sameConsent(grant, offer.consent), hasConsent: grant !== null }
  }

  /** Download the runtime on explicit request, deduplicating requests within this process.
   *  由用户显式请求下载运行库，在当前进程内合并重复请求。 */
  async install(): Promise<void> {
    this.assertEnabled()
    this.download ??= installNative(this.root).finally(() => { this.download = undefined })
    await this.download
  }

  /** Save the reviewed default offer or immediately revoke the stored approval.
   *  保存已审阅的默认方案同意记录，或立即撤销现有同意。 */
  async consent(review: Consent | null): Promise<void> {
    const store = await this.local()
    const revision = store.beginConsentChange(review === null)
    if (review === null) return
    const offer = await this.cloud.offer()
    this.assertEnabled()
    if (offer === null || !sameConsent(review, offer.consent)) throw MemoryError.invalid('Refresh and review the current free memory offer.')
    if (!store.confirmConsent(revision, offer.consent)) {
      throw new MemoryError('concurrent_modification', 'A newer memory consent decision was saved. Refresh to see the current state.')
    }
  }

  /** Generate a draft from user-entered text with approval, leaving local profiles unchanged.
   *  根据用户输入生成已获同意的草稿，保持本地画像原样。 */
  async draft(scope: 'user' | 'project', text: string, signal?: AbortSignal): Promise<string[]> {
    const store = await this.local()
    const approval = await this.approved(store)
    return this.cloud.draft(approval.offer, scope, text, this.guard(store, approval, signal))
  }

  /** Combine local keyword hits with an explicit semantic search and return current SQLite rows.
   *  合并本地关键词命中和显式语义检索，返回当前 SQLite 记录。 */
  async search(project: string, text: string, semantic: boolean, signal?: AbortSignal): Promise<RecordEntry[]> {
    const store = await this.local()
    if (!semantic) return store.search(project, text, 12)
    const library = await libraryPath(this.root)
    this.assertEnabled()
    if (library === null) throw MemoryError.invalid('Install VLDB before running semantic search.')
    const approval = await this.approved(store)
    const { offer } = approval
    const guard = this.guard(store, approval, signal)
    guard.check()
    const model = fingerprint([offer.consent, offer.dimension])
    const pending = store.pending(project, model)
    // Index a bounded batch per search to avoid a background uploader and respect free quotas.
    // 每次检索只索引一小批记录，避免后台上传并遵守免费额度。
    const [vectors, [vector]] = await Promise.all([
      pending.length === 0 ? Promise.resolve([]) : this.cloud.embed(offer, pending.map(entry => `${entry.title}\n${entry.body}`), 'document', guard),
      this.cloud.embed(offer, [text], 'query', guard),
    ])
    guard.check()
    if (vector === undefined) throw new Error('OpenVulcan did not return a query embedding.')
    const entries = pending.map((entry, index) => ({ id: entry.id, revision: entry.revision,
      scopeKey: entry.scope === 'project' ? entry.project : entry.scope, embedding: vectors[index]! }))
    const hits = await this.native({ root: this.root, library, model, project, vector, entries }, signal)
    guard.check()
    store.acknowledge(model, pending)
    // Stale and deleted vectors cannot resurrect content. SQLite owns scope, body and revision.
    // 陈旧和已删除的向量无法恢复内容。范围、正文和版本均以 SQLite 为准。
    const ranked = new Map<string, { entry: RecordEntry; score: number }>()
    const semanticRows = hits.flatMap(hit => {
      const entry = store.get(project, hit.id)
      return entry?.kind === 'memory' && entry.revision === hit.revision ? [entry] : []
    })
    for (const rows of [semanticRows, store.search(project, text, 12)]) {
      rows.forEach((entry, index) => {
        ranked.set(entry.id, { entry, score: (ranked.get(entry.id)?.score ?? 0) + 1 / (60 + index) })
      })
    }
    return [...ranked.values()].sort((left, right) => right.score - left.score).slice(0, 12).map(hit => hit.entry)
  }

  /** Fail if the plugin unloaded or the profile switched modes during an async operation.
   *  异步操作期间插件卸载或配置切换模式时显式失败。 */
  private assertEnabled(): void {
    this.lifetime.signal.throwIfAborted()
    if (!this.enabled()) throw MemoryError.invalid('Select SQLite memory mode first.')
  }

  /** Validate local approval for a fresh offer before accessing cloud inference.
   *  调用云端推理前校验用户是否同意当前方案。 */
  private async approved(store: SqliteStore): Promise<ApprovedOffer> {
    const { grant, revision } = store.consent()
    if (grant === null) throw MemoryError.invalid('Approve the OpenVulcan free memory offer in settings first.')
    const offer = await this.cloud.offer()
    if (offer === null) throw MemoryError.invalid('Sign in to OpenVulcan to use the free memory service.')
    const approval = { offer, revision }
    this.assertApproval(store, approval)
    return approval
  }

  /** Check mode and consent again across async boundaries.
   *  跨越异步边界后再次检查模式和同意记录。 */
  private assertApproval(store: SqliteStore, approval: ApprovedOffer): void {
    this.assertEnabled()
    const { grant, revision } = store.consent()
    if (revision !== approval.revision || !sameConsent(grant, approval.offer.consent)) {
      throw MemoryError.invalid('Review and approve the current free memory offer.')
    }
  }

  /** Share mode, consent and cancellation checks with asynchronous inference.
   *  将模式、同意和取消检查传入异步推理。 */
  private guard(store: SqliteStore, approval: ApprovedOffer, requestSignal?: AbortSignal) {
    const signal = requestSignal === undefined ? this.lifetime.signal : AbortSignal.any([this.lifetime.signal, requestSignal])
    return { signal, check: () => { signal.throwIfAborted(); this.assertApproval(store, approval) } }
  }

  /** Run one isolated FFI process and resolve validated hits within a fixed deadline.
   *  在独立 FFI 进程中执行任务，并在限定时间内返回校验过的命中项。 */
  private native(request: VectorRequest, signal?: AbortSignal): Promise<z.infer<typeof hitsSchema>['hits']> {
    const deadline = AbortSignal.timeout(30_000)
    const cancellation = AbortSignal.any([this.lifetime.signal, deadline, ...(signal === undefined ? [] : [signal])])
    cancellation.throwIfAborted()
    return new Promise((resolve, reject) => {
      const child = fork(fileURLToPath(new URL('./native-worker.js', import.meta.url)), {
        execArgv: [], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
      })
      const unavailable = () => { reject(new Error('The installed VLDB runtime could not complete the search.')) }
      const abort = () => { child.kill(); unavailable() }
      cancellation.addEventListener('abort', abort, { once: true })
      child.once('close', () => { cancellation.removeEventListener('abort', abort); unavailable() })
      child.once('error', unavailable)
      child.once('message', (reply) => {
        const parsed = hitsSchema.safeParse(reply)
        if (parsed.success) resolve(parsed.data.hits)
        else unavailable()
      })
      child.send(request, error => { if (error) { child.kill(); unavailable() } })
    })
  }
}
