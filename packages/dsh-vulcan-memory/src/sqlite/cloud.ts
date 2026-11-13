import { createHash } from 'node:crypto'
import { SITES, type AccountSource, type Credential } from '@openvulcan/openvulcan-account'
import { z } from 'zod'
import type { Consent } from './store.js'
import { maskBasic, redactPayload, redactText, type PiiSnapshot } from './pii.js'

// Parse only published fields from the dedicated free memory inference catalog.
// 只解析专用免费记忆推理目录中公布的字段。
const offerSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), consent_revision: z.string().regex(/^[a-f0-9]{64}$/),
  embedding_dimension: z.number().int().min(1).max(4096),
  providers: z.array(z.object({
    capability: z.string(), model: z.string(), provider: z.string(), region: z.string(), data_policy: z.string(),
    privacy_url: z.url({ protocol: /^https$/ }), purposes: z.array(z.string()).optional(),
  })),
})

// Expose consent and provider metadata without exposing the device credential.
// 对外提供同意记录和服务商信息，不暴露设备凭据。
export interface CloudOffer {
  consent: Consent
  site: Credential['site']
  name: string
  dimension: number
  providers: z.infer<typeof offerSchema>['providers']
  profile: boolean
  // Indicate whether the free offer supports both stages of the corresponding workflow.
  // 表示免费方案是否支持对应流程的两个阶段。
  precheck: boolean
  postaction: boolean
}

// Recheck approval at the network boundary after asynchronous credential resolution.
// 异步解析凭据后，在网络边界重新检查同意状态。
interface InferenceGuard {
  check(): void
  signal: AbortSignal
  pii: PiiSnapshot
}

/** Hash structured identities so identifiers cannot become filesystem names or SQL fragments.
 *  对结构化标识取摘要，避免标识被直接用作文件名或 SQL 片段。 */
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Compare the exact authorization, model and disclosure revision the user reviewed.
 *  比较用户实际查看过的授权、模型和披露版本。 */
export function sameConsent(left: Consent | null, right: Consent): boolean {
  return left !== null && left.binding === right.binding && left.id === right.id && left.revision === right.revision
}

/** Remove common secret forms before submitting bounded business text.
 *  提交有限长度的业务文本前，移除常见的凭据形式。 */
export function scrub(text: string, policy?: PiiSnapshot): string {
  return (policy === undefined ? maskBasic(text) : redactText(text, policy).text).slice(0, 4200)
}

/** Use the account's regional OpenVulcan memory endpoint and server-selected free offer.
 *  使用账号所属站点的 OpenVulcan 记忆接口和服务端指定的免费方案。 */
export class MemoryCloud {
  /** Read the current account lazily so plugin load order and sign-in changes are reflected.
   *  延迟读取当前账号，以反映插件加载顺序和登录状态变化。 */
  constructor(private account: () => AccountSource | undefined) {}

  /** Return the current site's free default offer, or null when there is no signed-in account or offer.
   *  返回当前站点的默认免费方案，未登录或无方案时返回空值。 */
  async offer(): Promise<CloudOffer | null> {
    const account = this.account()
    if (account === undefined || (await account.status()).signedIn !== true) return null
    const credential = await account.credential()
    const catalog = z.object({ contract_version: z.literal(1), default_id: z.string(), models: z.array(z.unknown()) })
      .parse(await this.request(credential, 'capabilities'))
    if (catalog.default_id === '') return null
    const rows = catalog.models.filter(row => typeof row === 'object' && row !== null && 'id' in row && row.id === catalog.default_id)
    if (rows.length !== 1) throw new Error('OpenVulcan returned an invalid default memory offer.')
    const offer = offerSchema.parse(rows[0])
    if (!offer.providers.some(route => route.capability === 'embedding')) throw new Error('The default offer does not provide embeddings.')
    // An inference disclosure without purposes covers all generation stages in contract v1.
    // 版本 1 契约中，未列出用途的推理披露覆盖全部生成阶段。
    const providers = offer.providers.filter(route => route.capability === 'embedding' || route.capability === 'inference')
    const supports = (purpose: string) => providers.some(route => route.capability === 'inference'
      && (route.purposes === undefined || route.purposes.includes(purpose)))
    return { consent: { binding: this.binding(credential), id: offer.id, revision: offer.consent_revision },
      site: credential.site, name: offer.name, dimension: offer.embedding_dimension, providers,
      profile: supports('profile_instruction'), precheck: supports('pcl1') && supports('pcl2'),
      postaction: supports('ptl1') && supports('ptl2') }
  }

  /** Embed one batch of documents or queries and verify its order, shape and float32 range.
   *  为一批文档或查询生成向量，并校验行数、形状和 float32 范围。 */
  async embed(offer: CloudOffer, texts: string[], task: 'document' | 'query', guard: InferenceGuard): Promise<number[][]> {
    const result = z.array(z.array(z.number().refine(value => Number.isFinite(Math.fround(value)))).length(offer.dimension))
      .length(texts.length)
      .parse(await this.infer(offer, 'embedding', { texts, task }, guard))
    if (result.some(vector => !vector.some(value => Math.fround(value) !== 0))) throw new Error('OpenVulcan returned an empty embedding.')
    return result
  }

  /** Return suggested profile sentences for manual review without mutating local records.
   *  返回供人工审阅的画像建议，不改写本地记录。 */
  async draft(offer: CloudOffer, scope: 'user' | 'project', instruction: string, guard: InferenceGuard): Promise<string[]> {
    if (!offer.profile) throw new Error('The free default offer does not provide profile suggestions.')
    const result = z.object({ accepted_nodes: z.array(z.object({ normalized_content: z.string().trim().min(1).max(4000) })).nullish() })
      .parse(await this.infer(offer, 'profile_instruction', {
        target: scope === 'user' ? 'USER' : 'PROJECT', bind_id: scope === 'user' ? 'user' : 'project',
        instruction: scrub(instruction), authority_floor: { priority: 'P1', level: 'L2', reason: 'User-supplied profile draft' },
        active_nodes: [],
      }, guard))
    return (result.accepted_nodes ?? []).slice(0, 5).map(node => scrub(node.normalized_content, guard.pii))
  }

  /** Bind approval to a site and device authorization without persisting its token.
   *  将同意绑定到站点和设备授权，凭据令牌不落盘。 */
  private binding(credential: Credential): string {
    return fingerprint([credential.site, credential.authorization_id])
  }

  /** Resolve and check the active authorization for the approved offer.
   *  获取并校验已同意方案对应的当前授权。 */
  private async currentCredential(offer: CloudOffer): Promise<Credential> {
    const account = this.account()
    if (account === undefined) throw new Error('Sign in to OpenVulcan to use cloud memory.')
    const credential = await account.credential()
    if (this.account() !== account || this.binding(credential) !== offer.consent.binding) {
      throw new Error('OpenVulcan account changed. Review the free offer again.')
    }
    return credential
  }

  /** Send the exact approved offer revision using the currently active authorization.
   *  使用当前有效授权发送准确的已同意方案版本。 */
  async infer(offer: CloudOffer, purpose: 'embedding' | 'profile_instruction' | 'pcl1' | 'pcl2' | 'ptl1' | 'ptl2',
    input: object, guard: InferenceGuard): Promise<unknown> {
    const credential = await this.currentCredential(offer)
    guard.check()
    const response = await this.request(credential, 'infer', {
      contract_version: 1, model_id: offer.consent.id, consent_revision: offer.consent.revision, purpose,
      input: redactPayload(input, guard.pii),
    }, guard.signal)
    await this.currentCredential(offer)
    guard.check()
    return z.object({ result: z.unknown() }).parse(response).result
  }

  /** Send a regional API request with redirects disabled and bounded execution time.
   *  发送区域 API 请求，禁用重定向并限制执行时间。 */
  private async request(credential: Credential, endpoint: 'capabilities' | 'infer', body?: object, signal?: AbortSignal): Promise<unknown> {
    const origin = SITES[credential.site].auth
    if (credential.auth_origin !== origin) throw new Error('OpenVulcan authorization origin does not match the account site.')
    const timeout = AbortSignal.timeout(endpoint === 'infer' ? 35_000 : 8_000)
    const response = await fetch(`${origin}/api/v1/vulcancode/memory-inference/${endpoint}`, {
      method: endpoint === 'infer' ? 'POST' : 'GET', redirect: 'error',
      headers: { Authorization: `Auth ${credential.access_token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    })
    if (!response.ok) throw new Error(response.status === 409
      ? 'The free memory offer changed. Refresh its details and approve it again.'
      : `OpenVulcan memory service is unavailable (HTTP ${response.status}).`)
    return response.json()
  }
}
