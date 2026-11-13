import { readFileSync } from 'node:fs'
import { z } from 'zod'

// Select from the bundled regional rules and independently configure both noise stages.
// 从随包发布的地区规则中选择，并独立配置两级噪声过滤。
export const textPolicySchema = z.strictObject({
  region: z.enum(['zh-CN', 'zh-TW', 'zh-HK', 'en-US']),
  noise: z.boolean(),
  semanticNoise: z.boolean(),
})
export type TextPolicy = z.infer<typeof textPolicySchema>
export const DEFAULT_TEXT_POLICY: TextPolicy = { region: 'zh-CN', noise: true, semanticNoise: true }

// Read the versioned VulcanCode rule resources included with the plugin.
// 读取插件随附的 VulcanCode 版本化规则资源。
const resourceRoot = new URL('../../assets/text-policy/', import.meta.url)
const piiSchema = z.object({ version: z.literal('2.0.0'), rules: z.array(z.object({
  name: z.string(), pattern: z.string(), replacement: z.string(), condition: z.string().optional(),
})) })
const noiseSchema = z.object({ version: z.literal('1.0.0'), categories: z.array(z.object({
  name: z.string(), targets: z.array(z.enum(['user', 'assistant'])), threshold: z.number().min(0).max(1),
  patterns: z.array(z.string()), phrases: z.array(z.string()),
})) })

/** Read one packaged rules file as JSON. Missing or invalid assets stop the operation.
 *  将一个随包发布的规则文件读为 JSON，文件缺失或无效时停止操作。 */
function resource(file: string): unknown {
  return JSON.parse(readFileSync(new URL(file, resourceRoot), 'utf8'))
}

/** Compile a bundled Rust regex using equivalent JavaScript Unicode and inline flags.
 *  使用对应的 JavaScript Unicode 和内联标志编译随包 Rust 正则。 */
function patternOf(pattern: string, flags: string): RegExp {
  const prefix = /^\(\?([is]+)\)/.exec(pattern)
  const body = (prefix === null ? pattern : pattern.slice(prefix[0].length))
    .replaceAll('\\p{Han}', '\\p{Script=Han}').replaceAll('\\"', '"')
  return new RegExp(body,
    [...new Set(flags + (prefix === null ? '' : prefix[1]))].join(''))
}

/** Verify the right-to-left Luhn checksum of a matched number.
 *  从右到左校验命中号码的 Luhn 校验和。 */
function luhn(value: string): boolean {
  return [...value].reverse().reduce((sum, digit, position) => {
    const n = Number(digit) * (position % 2 + 1)
    return sum + (n > 9 ? n - 9 : n)
  }, 0) % 10 === 0
}

// Recognize only conditions used by the shipped rules. No arbitrary expressions run.
// 只识别随包规则所用的条件，不执行任意表达式。
type Condition = (match: string[]) => boolean
/** Compile one pinned condition and fail closed on a new rule expression.
 *  编译一个固定条件，遇到新的规则表达式时停止处理。 */
function conditionOf(condition: string | undefined): Condition {
  if (condition === undefined) return () => true
  if (condition === 'is_luhn($0)') return ([full]) => luhn(full!)
  if (condition === 'len($0) >= 16 && len($0) <= 19 && is_luhn($0)') {
    return ([full]) => full!.length >= 16 && full!.length <= 19 && luhn(full!)
  }
  if (condition === '(weight_sum($1, [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2]) % 11) == cn_check($2)') {
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
    return ([, digits, check]) => [...digits!].reduce((sum, digit, i) => sum + Number(digit) * weights[i]!, 0) % 11
      === '10X98765432'.indexOf(check!.toUpperCase())
  }
  const length = /^len\(\$0\) (==|>) (\d+)$/.exec(condition)
  if (length !== null) {
    const minimum = Number(length[2])
    return ([full]) => length[1] === '==' ? Buffer.byteLength(full!) === minimum : Buffer.byteLength(full!) > minimum
  }
  throw new Error('Unsupported VulcanCode PII rule condition.')
}

// Share compiled immutable resource rules across previews and inference requests.
// 在预览和推理请求之间共享已编译的不可变资源规则。
const piiRules = new Map<TextPolicy['region'], ReturnType<typeof compilePii>>()

// Keep DSH's existing shorter credential-assignment and Auth header protection.
// 保留 DSH 对较短凭据赋值及 Auth 请求头的已有脱敏规则。
const basicRules: ReadonlyArray<readonly [string, RegExp]> = [
  ['DSH_PRIVATE_KEY', /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi],
  ['DSH_AUTH_TOKEN', /\b(?:Bearer|Auth)\s+[\w.~/+=-]{12,}/gi],
  ['DSH_CREDENTIAL', /\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi],
  ['DSH_EMAIL', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
]

/** Preserve basic secret masking during bounded session text capture.
 *  采集限长会话文本时保留基础凭据脱敏。 */
export function maskBasic(text: string, matches?: Set<string>): string {
  for (const [name, regex] of basicRules) {
    text = text.replace(regex, () => {
      matches?.add(name)
      return '[redacted]'
    })
  }
  return text
}
/** Compile the selected region followed by the common credential and identity rules.
 *  编译所选地区规则及后续通用凭据和身份规则。 */
function compilePii(region: TextPolicy['region']) {
  return [region, 'common'].flatMap(name => piiSchema.parse(resource(`pii/${name}.json`)).rules).map(rule => ({
    ...rule, regex: patternOf(rule.pattern, 'gu'), applies: conditionOf(rule.condition),
  }))
}

/** Apply regional masking and return safe rule names for local preview.
 *  执行地区脱敏，返回可在本机预览中展示的规则名称。 */
export function redactText(text: string, region: TextPolicy['region']): { text: string; matches: string[] } {
  let rules = piiRules.get(region)
  if (rules === undefined) {
    rules = compilePii(region)
    piiRules.set(region, rules)
  }
  const matches = new Set<string>()
  for (const rule of rules) {
    text = text.replace(rule.regex, (full: string, ...captures: unknown[]) => {
      const groups = [full, ...captures.slice(0, -2)] as string[]
      if (!rule.applies(groups)) return groups[0]!
      matches.add(rule.name)
      return rule.replacement.replace(/\$(\d+)/g, (_, index: string) => groups[Number(index)] ?? '')
    })
  }
  return { text: maskBasic(text, matches), matches: [...matches] }
}

/** Mask all string fields in a cloud business payload while keeping opaque IDs intact.
 *  对云端业务载荷的字符串进行脱敏，同时保留不透明标识。 */
export function redactPayload(value: unknown, region: TextPolicy['region'], field?: string): unknown {
  if (typeof value === 'string') {
    if (field === 'id' || field === 'bind_id' || field === 'turn_id' || field === 'memory_id' ||
      field === 'source_turn_id' || field === 'created_datetime' || field === 'datetime' || field === 'candidate_datetime' ||
      field === 'current_datetime' || field === 'current_turn_datetime' || field === 'latest_active_datetime') return value
    return redactText(value, region).text
  }
  if (Array.isArray(value)) return value.map(item => redactPayload(item, region, field))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactPayload(item, region, key)]))
}

// Load user-targeted categories only, matching VulcanCode's single-turn intake.
// 只加载面向用户的类别，与 VulcanCode 单轮准入一致。
const noiseRules = new Map<'common' | 'zh-CN', ReturnType<typeof compileNoise>>()
/** Compile common categories and replace matching categories for Chinese input.
 *  编译通用类别，中文输入时替换有对应地区规则的类别。 */
function compileNoise(language: 'common' | 'zh-CN') {
  const files = language === 'common' ? ['common'] : ['common', 'zh-CN']
  const categories = new Map<string, z.infer<typeof noiseSchema>['categories'][number]>()
  for (const file of files) {
    for (const category of noiseSchema.parse(resource(`noise/${file}.json`)).categories) categories.set(category.name, category)
  }
  return [...categories.values()].filter(category => category.targets.includes('user'))
    .map(category => ({ ...category, regex: category.patterns.map(pattern => patternOf(pattern, 'iu')) }))
}

/** Return the ordered noise rule set for the user prompt's language.
 *  返回符合用户提示词语言的有序噪声规则。 */
export function noiseFor(text: string) {
  const language = /\p{Script=Han}/u.test(text) ? 'zh-CN' : 'common'
  let categories = noiseRules.get(language)
  if (categories === undefined) {
    categories = compileNoise(language)
    noiseRules.set(language, categories)
  }
  return categories
}

/** Compare embeddings with cosine similarity independently of provider normalization.
 *  以余弦相似度比较向量，无需依赖服务方的归一化方式。 */
export function similarity(left: number[], right: number[]): number {
  const dot = left.reduce((sum, value, index) => sum + value * right[index]!, 0)
  return dot / (Math.hypot(...left) * Math.hypot(...right))
}
