import { createHash } from 'node:crypto'
import { z } from 'zod'
import { bundledRules, rulePattern } from './rule-resources.js'

// Use the exact shipped common-only and common-plus-Chinese compositions.
// 使用随包的通用及通用加中文组合。
export const noiseLanguage = z.enum(['common', 'zh-CN'])
export const noiseThreshold = z.number().gt(0).max(1)
// Bound the serialized prototype cache to the provider's supported matrix sizes.
// 将原型缓存限制为服务端支持的矩阵大小。
export const noisePrototypeSchema = z.array(z.array(z.number().refine(value => Number.isFinite(Math.fround(value))))
  .min(1).max(4096)).max(96)
// Validate rule structure and bound the number of prototype requests.
// 校验规则结构并限制语义原型请求量。
const fileSchema = z.strictObject({
  language: noiseLanguage, version: z.literal('1.0.0'),
  categories: z.array(z.strictObject({
    name: z.string().trim().min(1).max(100), targets: z.array(z.string().trim().toLowerCase().pipe(z.enum(['user', 'assistant']))).default([]),
    threshold: z.number().default(0), patterns: z.array(z.string().max(4096)).max(64).default([]),
    phrases: z.array(z.string().max(420)).max(48).default([]),
  })).max(32),
})

/** Compile and validate one source file, preserving role, rule, and phrase order.
 *  编译并校验一份来源文件，保留角色、规则和短语顺序。 */
export function compileNoiseFile(selector: string, source: string, threshold: number) {
  const file = fileSchema.parse(JSON.parse(source))
  if (file.language !== selector) throw new Error('The noise rule language must match the selected file.')
  const names = new Set<string>()
  return file.categories.map(category => {
    if (names.has(category.name)) throw new Error('Noise category names must be unique within a file.')
    names.add(category.name)
    return {
      name: category.name,
      user: category.targets.length === 0 || category.targets.includes('user'),
      threshold: category.threshold > 0 ? category.threshold : threshold,
      regex: category.patterns.map(pattern => pattern.trim()).filter(Boolean).map(pattern => rulePattern(pattern, true)),
      phrases: [...new Set(category.phrases.map(phrase => phrase.trim().replace(/[ \t\n\r\f]+/g, ' ')).filter(Boolean))],
    }
  })
}

// Cache the two bundled files and the last effective composition.
// 缓存两份随包文件和最近的生效组合。
const defaults = new Map<string, string>()
let last: { key: string; snapshot: ReturnType<typeof compileNoise> } | undefined

/** Return the exact shipped noise JSON for the selected file.
 *  返回指定噪声文件的准确随包 JSON。 */
export function defaultNoise(selector: string): string {
  let text = defaults.get(selector)
  if (text === undefined) {
    text = bundledRules('noise', noiseLanguage.parse(selector))
    defaults.set(selector, text)
  }
  return text
}

/** Compile ordered common and locale rules and their semantic targets for user intake.
 *  按顺序编译通用与地区规则，以及用户准入用的语义原型。 */
function compileNoise(language: string, threshold: number, common: string, regional?: string) {
  const categories = compileNoiseFile('common', common, threshold)
  if (regional !== undefined) categories.push(...compileNoiseFile(language, regional, threshold))
  const rules = [...new Map(categories.map(category => [category.name, category])).values()].filter(category => category.user)
  const targets = rules.flatMap(rule => rule.phrases.map(phrase => ({ name: rule.name, phrase, threshold: rule.threshold })))
  if (targets.length > 96) throw new Error('Too many semantic noise phrases.')
  const digest = createHash('sha256').update(JSON.stringify([language, threshold, common, regional])).digest('hex')
  return { digest, rules, targets }
}

/** Return a compiled snapshot for the exact active rules and threshold.
 *  返回准确生效规则及阈值对应的编译快照。 */
export function noiseSnapshot(language: string, threshold: number, common = defaultNoise('common'), regional?: string) {
  const locale = noiseLanguage.parse(language)
  const overlay = locale === 'common' ? undefined : regional ?? defaultNoise(locale)
  const key = JSON.stringify([locale, threshold, common, overlay])
  if (last?.key !== key) last = { key, snapshot: compileNoise(locale, threshold, common, overlay) }
  return last.snapshot
}

// Describe the frozen compiled noise rules used by preview and admission.
// 描述预览和准入使用的冻结噪声规则。
export type NoiseSnapshot = ReturnType<typeof noiseSnapshot>

/** Find the first matching deterministic category for the canonical user prompt.
 *  查找规范用户提示词命中的首个确定性类别。 */
export function detectNoise(text: string, snapshot: NoiseSnapshot): string | null {
  const input = text.trim()
  if (input === '') return null
  return snapshot.rules.find(rule => rule.regex.some(regex => regex.test(input)))?.name ?? null
}

/** Compare two provider vectors using VulcanCode's float32 normalization and widened dot product.
 *  使用 VulcanCode 的单精度归一化与扩宽点积比较两个服务向量。 */
export function similarity(left: number[], right: number[]): number {
  /** Return the source float32 square-root scale of the given vector.
   *  返回给定向量按上游计算的单精度平方根尺度。 */
  const scale = (vector: number[]) => Math.fround(Math.sqrt(vector.reduce((sum, raw) => {
    const value = Math.fround(raw)
    return sum + Math.fround(value * value)
  }, 0)))
  const a = scale(left)
  const b = scale(right)
  return left.reduce((sum, value, index) => {
    const l = a === 0 ? Math.fround(value) : Math.fround(Math.fround(value) / a)
    const raw = Math.fround(right[index]!)
    const r = b === 0 ? raw : Math.fround(raw / b)
    return sum + Math.fround(l * r)
  }, 0)
}

// Report a local or cloud-assisted admission result without retaining the sample text.
// 返回本机或云端辅助准入结果，不保留样本文本。
export type NoiseDecision = { category: string | null; source: 'disabled' | 'timeline' | 'regex' | 'semantic' | 'regex-fallback'; confidence: number }

/** Apply the saved user-intake policy using only the caller's authorized embedding function.
 *  仅使用调用者的已授权嵌入函数执行已保存的用户准入策略。 */
export async function evaluateNoise(text: string, timeline: boolean, enabled: boolean, semantic: boolean,
  rules: NoiseSnapshot, embed: (texts: string[]) => Promise<number[][]>, readCache: () => number[][] | undefined,
  cache: (vectors: number[][]) => void, check: () => void): Promise<NoiseDecision> {
  if (timeline) return { category: null, source: 'timeline', confidence: 0 }
  if (!enabled) return { category: null, source: 'disabled', confidence: 0 }
  const category = detectNoise(text, rules)
  if (category !== null || !semantic || text.trim() === '' || rules.targets.length === 0) {
    return { category, source: 'regex', confidence: category === null ? 0 : 1 }
  }
  try {
    let prototypes = readCache()
    if (prototypes === undefined) {
      prototypes = []
      for (let offset = 0; offset < rules.targets.length; offset += 10) {
        prototypes.push(...await embed(rules.targets.slice(offset, offset + 10).map(target => target.phrase)))
      }
      check()
      cache(prototypes)
    }
    const [vector] = await embed([text])
    check()
    for (const [index, target] of rules.targets.entries()) {
      const confidence = similarity(vector!, prototypes[index]!)
      if (Number.isFinite(confidence) && confidence >= target.threshold) return { category: target.name, source: 'semantic', confidence }
    }
    return { category: null, source: 'semantic', confidence: 0 }
  } catch {
    // A real embedding failure may degrade. A stale consent or cancelled task must stop.
    // 嵌入服务故障可降级，授权过期或任务取消时必须停止。
    check()
    return { category: null, source: 'regex-fallback', confidence: 0 }
  }
}
