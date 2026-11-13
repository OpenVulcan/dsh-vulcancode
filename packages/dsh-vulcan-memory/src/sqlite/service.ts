import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { AccountSource } from '@openvulcan/openvulcan-account'
import { z } from 'zod'
import { MemoryError } from '../markdown/errors.js'
import { fingerprint, MemoryCloud, sameConsent, scrub, type CloudOffer } from './cloud.js'
import { installNative, libraryPath, nativeStatus, NATIVE_VERSION } from './native-install.js'
import type { VectorRequest } from './native-worker.js'
import { SqliteStore, type Consent, type RecordEntry } from './store.js'
import { postaction, precheck, type CompletedTurn } from './workflow.js'
import { noiseFor, similarity, type TextPolicy } from './text-policy.js'

// Parse the native child's bounded reply without loading Koffi in the dsh process.
// 解析原生子进程的有限响应，避免在 dsh 主进程中加载 Koffi。
const hitsSchema = z.object({ hits: z.array(z.object({ id: z.uuid(), revision: z.uuid() })).max(24) })

// Bind one inference operation to the grant revision checked before its first cloud request.
// 将一次推理操作绑定到首个云端请求前校验的授权版本。
interface ApprovedOffer {
  readonly offer: CloudOffer
  readonly revision: string
}

/** Manage vector memory and consent-gated access to the free cloud service.
 *  管理向量记忆，以及经用户同意的免费云端服务访问。 */
export class StructuredMemory {
  // Keep a single lazy database, active download and cancellation source per plugin instance.
  // 每个插件实例共用一个延迟打开的数据库、下载任务和取消信号。
  private store: Promise<SqliteStore> | undefined
  private download: Promise<void> | undefined
  private lifetime = new AbortController()
  private cloud: MemoryCloud
  // Coalesce global indexing requests and serialize turn reviews in this process.
  // 合并全局索引请求，并在当前进程内串行执行回合审核。
  private indexing: Promise<void> | undefined
  private indexRequested = false
  private indexTimer: ReturnType<typeof setTimeout> | undefined
  private reviews = Promise.resolve()
  private pendingReviews = 0
  private modeLifetime = new AbortController()
  // Cache semantic prototypes only for the active offer and the two bundled noise languages.
  // 仅为当前方案与两种随包噪声语言缓存语义原型。
  private noiseModel = ''
  private prototypes = new Map<ReturnType<typeof noiseFor>, number[][]>()

  /** Receive the private data root and functions for checking current mode and account.
   *  接收私有数据根目录，以及查询当前模式和账号的函数。 */
  constructor(private root: string, private enabled: () => boolean, account: () => AccountSource | undefined) {
    this.cloud = new MemoryCloud(account)
  }

  /** Close database resources and cancel child operations on plugin unload.
   *  插件卸载时关闭数据库并取消子进程任务。 */
  dispose(): void {
    this.lifetime.abort()
    clearTimeout(this.indexTimer)
    void this.store?.then(store => { store.close() }, () => {})
  }

  /** Cancel work from the previous mode and allow a later activation to start fresh.
   *  取消旧模式的任务，后续重新启用时使用新的取消信号。 */
  modeChanged(): void {
    this.modeLifetime.abort()
    clearTimeout(this.indexTimer)
    this.modeLifetime = new AbortController()
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
      approved: offer !== null && sameConsent(grant, offer.consent),
      automatic: offer !== null && grant?.automatic === true && sameConsent(grant, offer.consent),
      hasConsent: grant !== null }
  }

  /** Read the local policy without contacting OpenVulcan.
   *  读取本机策略，不访问 OpenVulcan。 */
  async textPolicy(): Promise<TextPolicy> {
    return (await this.local()).textPolicy()
  }

  /** Save the policy and invalidate pending work under the old privacy rules.
   *  保存策略并使旧隐私规则下的待处理工作失效。 */
  async saveTextPolicy(policy: TextPolicy): Promise<void> {
    (await this.local()).saveTextPolicy(policy)
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
    if (review.automatic === true && (!offer.precheck || !offer.postaction)) {
      throw MemoryError.invalid('The free offer must support both recall and turn distillation.')
    }
    if (!store.confirmConsent(revision, { ...offer.consent, ...(review.automatic === true ? { automatic: true } : {}) })) {
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
  async search(project: string, text: string, semantic: boolean, signal?: AbortSignal, automatic = false): Promise<RecordEntry[]> {
    const store = await this.local()
    if (!semantic) return store.search(project, text, 12)
    const library = await this.requireLibrary()
    const approval = await this.approved(store, automatic)
    const guard = this.guard(store, approval, signal)
    await this.indexBatch(store, approval, library, project, guard)
    return this.retrieve(store, approval, library, project, [text], guard)
  }

  /** Recall approved vector memory and active profiles for one live human turn.
   *  为一个正在进行的用户回合召回经授权的向量记忆和活跃画像。 */
  async recall(project: string, text: string, recent: readonly CompletedTurn[], signal: AbortSignal): Promise<RecordEntry[]> {
    const store = await this.local()
    if (store.consent().grant?.automatic !== true) return []
    const profiles = store.list(project, 'profile', 6)
    if (text.trim() === '' || store.list(project, 'memory', 1).length === 0) return profiles
    const library = await libraryPath(this.root)
    if (library === null) return profiles
    const approval = await this.approved(store, true)
    const guard = this.guard(store, approval, signal)
    guard.check()
    if (!approval.offer.precheck) return profiles
    const memories = await precheck(text, recent, (purpose, input) => this.cloud.infer(approval.offer, purpose, input, guard),
      queries => this.retrieve(store, approval, library, project, queries, guard), value => scrub(value, guard.region))
    guard.check()
    return [...profiles, ...memories].filter(record => store.get(project, record.id)?.revision === record.revision)
  }

  /** Write a manual change first, so unavailable inference never loses the record.
   *  先保存手工修改，确保推理不可用时记录仍能保留。 */
  async write(project: string, input: unknown): Promise<RecordEntry | null> {
    return (await this.local()).write(project, input)
  }

  /** Queue a committed turn for extraction, review and one atomic revision-checked write.
   *  将已提交回合排入提取和审核队列，并进行一次带版本检查的原子写入。 */
  distill(project: string, turn: CompletedTurn, consentRevision: string): Promise<void> {
    if (this.pendingReviews >= 8) return Promise.reject(new Error('The memory review queue is full.'))
    this.pendingReviews++
    const signal = this.modeLifetime.signal
    const work = this.reviews.then(async () => {
      if (signal.aborted || !this.enabled()) return
      const store = await this.local()
      if (store.hasDistilled(turn.id) || store.consent().revision !== consentRevision) return
      const library = await libraryPath(this.root)
      if (library === null) return
      const approval = await this.approved(store, true)
      if (approval.revision !== consentRevision) return
      if (!approval.offer.postaction) return
      const guard = this.guard(store, approval, signal)
      if (await this.isNoise(turn, store.textPolicy(), approval, guard)) {
        guard.check()
        store.commitDistillation(project, turn.id, approval.revision, [], [])
        return
      }
      const profiles = store.list(project, 'profile', 24)
      const result = await postaction(turn, project, profiles,
        (purpose, input) => this.cloud.infer(approval.offer, purpose, input, guard),
        queries => this.retrieve(store, approval, library, project, queries, guard))
      guard.check()
      const changes = result.changes.map(change => ({ ...change, record: { ...change.record,
        title: scrub(change.record.title, guard.region).slice(0, 160), body: scrub(change.record.body, guard.region).slice(0, 4_000) } }))
      store.commitDistillation(project, turn.id, approval.revision, changes, result.retire)
      if (result.changes.some(change => change.record.kind === 'memory') || result.retire.length > 0) {
        await this.indexBatch(store, approval, library, project, guard)
      }
    }).finally(() => { this.pendingReviews-- })
    this.reviews = work.catch(() => {})
    return work
  }

  /** Apply the user prompt's noise policy before sending any extraction request.
   *  在发出提炼请求之前对用户提示词执行噪声策略。 */
  private async isNoise(turn: CompletedTurn, policy: TextPolicy, approval: ApprovedOffer,
    guard: ReturnType<StructuredMemory['guard']>): Promise<boolean> {
    // Timeline turns retain mixed evidence. Only simple turns use the intake filter.
    // 时间线回合保留混合证据，仅简单回合经过准入过滤。
    if (!policy.noise || turn.dialogue.timeline.length > 0) return false
    const user = scrub(turn.dialogue.user, guard.region).trim()
    const rules = noiseFor(user)
    if (rules.some(rule => rule.regex.some(regex => regex.test(user)))) return true
    if (!policy.semanticNoise || user === '') return false
    const { offer } = approval
    const model = fingerprint([offer.consent, offer.dimension])
    if (model !== this.noiseModel) {
      this.noiseModel = model
      this.prototypes.clear()
    }
    const targets = rules.flatMap(rule => rule.phrases.map(phrase => ({ phrase, threshold: rule.threshold })))
    let prototypes = this.prototypes.get(rules)
    if (prototypes === undefined) {
      prototypes = []
      for (let offset = 0; offset < targets.length; offset += 10) {
        prototypes.push(...await this.cloud.embed(offer, targets.slice(offset, offset + 10).map(target => target.phrase), 'document', guard))
      }
      this.prototypes.set(rules, prototypes)
    }
    const [vector] = await this.cloud.embed(offer, [user], 'document', guard)
    return targets.some((target, index) => similarity(vector!, prototypes[index]!) >= target.threshold)
  }

  /** Backfill old and edited memories across projects in resumable, quota-bounded batches.
   *  跨项目分批补建旧记忆和已修改记忆的向量，受额度限制且可继续。 */
  reindex(): Promise<void> {
    clearTimeout(this.indexTimer)
    this.indexRequested = true
    this.indexing ??= this.drainIndex().finally(() => { this.indexing = undefined })
    return this.indexing
  }

  /** Drain at most five batches per trigger so a large legacy store does not monopolize the free quota.
   *  每次触发最多处理五批，避免大型历史库占满免费额度。 */
  private async drainIndex(): Promise<void> {
    const signal = this.modeLifetime.signal
    for (let batch = 0; batch < 5 && this.indexRequested; batch++) {
      this.indexRequested = false
      if (signal.aborted || !this.enabled()) return
      try {
        const store = await this.local()
        if (store.consent().grant?.automatic !== true) return
        const library = await libraryPath(this.root)
        if (library === null) return
        const approval = await this.approved(store, true)
        const guard = this.guard(store, approval, signal)
        const indexed = await this.indexBatch(store, approval, library, undefined, guard)
        this.indexRequested ||= indexed === 10
      } catch (error) {
        if (!signal.aborted && !(error instanceof MemoryError)) this.retryIndex(60_000)
        throw error
      }
    }
    if (this.indexRequested && !signal.aborted) this.retryIndex(30_000)
  }

  /** Continue or retry pending batches after a quota-friendly pause.
   *  在给免费额度留出时间后继续或重试待处理批次。 */
  private retryIndex(delay: number): void {
    this.indexTimer = setTimeout(() => { void this.reindex().catch(() => {}) }, delay)
    this.indexTimer.unref()
  }

  /** Require the verified runtime library before a vector operation.
   *  执行向量操作前要求运行库通过验证。 */
  private async requireLibrary(): Promise<string> {
    const library = await libraryPath(this.root)
    this.assertEnabled()
    if (library === null) throw MemoryError.invalid('Install VLDB before running vector search.')
    return library
  }

  /** Index current revisions and reconcile old VLDB candidates. Return the number processed.
   *  索引当前版本并清理过时的 VLDB 候选，返回本批处理数量。 */
  private async indexBatch(store: SqliteStore, approval: ApprovedOffer, library: string, project: string | undefined,
    guard: ReturnType<StructuredMemory['guard']>): Promise<number> {
    const { offer } = approval
    const model = fingerprint([offer.consent, offer.dimension, 'pii-v2', guard.region])
    const pending = store.pending(project, model)
    const vectors = pending.length === 0 ? [] :
      await this.cloud.embed(offer, pending.map(entry => `${entry.title}\n${entry.body}`), 'document', guard)
    const entries = pending.map((entry, index) => ({ id: entry.id, revision: entry.revision,
      scopeKey: entry.scope === 'project' ? entry.project : entry.scope, embedding: vectors[index]! }))
    guard.check()
    await this.native({ root: this.root, library, model, project: project ?? '', dimension: offer.dimension, vector: null, entries }, guard.signal)
    guard.check()
    store.acknowledge(model, pending)
    return pending.length
  }

  /** Retrieve scoped VLDB matches, then fuse their ranks with local keyword matches.
   *  先执行范围受限的 VLDB 检索，再融合向量排名和本机词法排名。 */
  private async retrieve(store: SqliteStore, approval: ApprovedOffer, library: string, project: string,
    queries: string[], guard: ReturnType<StructuredMemory['guard']>): Promise<RecordEntry[]> {
    const { offer } = approval
    const model = fingerprint([offer.consent, offer.dimension, 'pii-v2', guard.region])
    const vectors = await this.cloud.embed(offer, queries, 'query', guard)
    const ranked = new Map<string, { entry: RecordEntry; score: number }>()
    // Stale and deleted vectors cannot resurrect content. SQLite owns scope, body and revision.
    // 陈旧和已删除的向量无法恢复内容。范围、正文和版本均以 SQLite 为准。
    for (const [queryIndex, vector] of vectors.entries()) {
      guard.check()
      const hits = await this.native({ root: this.root, library, model, project, dimension: offer.dimension, vector, entries: [] }, guard.signal)
      guard.check()
      const semanticRows = hits.flatMap(hit => {
        const entry = store.get(project, hit.id)
        return entry?.kind === 'memory' && entry.revision === hit.revision ? [entry] : []
      })
      for (const [channel, rows] of [semanticRows, store.search(project, queries[queryIndex]!, 12)].entries()) {
        rows.forEach((entry, rank) => {
          const score = (ranked.get(entry.id)?.score ?? 0) + (channel === 0 ? 2 : 1) / (60 + rank)
          ranked.set(entry.id, { entry, score })
        })
      }
    }
    return [...ranked.values()].sort((left, right) => right.score - left.score).slice(0, 12).map(hit => hit.entry)
  }

  /** Fail if the plugin unloaded or the profile switched modes during an async operation.
   *  异步操作期间插件卸载或配置切换模式时显式失败。 */
  private assertEnabled(): void {
    this.lifetime.signal.throwIfAborted()
    if (!this.enabled()) throw MemoryError.invalid('Select VMM vector memory mode first.')
  }

  /** Validate local approval for a fresh offer before accessing cloud inference.
   *  调用云端推理前校验用户是否同意当前方案。 */
  private async approved(store: SqliteStore, automatic = false): Promise<ApprovedOffer> {
    const { grant, revision } = store.consent()
    if (grant === null) throw MemoryError.invalid('Approve the OpenVulcan free memory offer in settings first.')
    if (automatic && grant.automatic !== true) throw MemoryError.invalid('Approve automatic vector memory first.')
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
    const signal = AbortSignal.any([this.lifetime.signal, this.modeLifetime.signal, ...(requestSignal === undefined ? [] : [requestSignal])])
    return { signal, region: store.textPolicy().region, check: () => { signal.throwIfAborted(); this.assertApproval(store, approval) } }
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
