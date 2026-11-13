import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { z } from 'zod'
import { compileCondition } from './pii-condition.js'
import { bundledRules, rulePattern } from './rule-resources.js'

// Use the packaged files as the single source of truth for the regional catalog.
// 使用随包文件作为地区目录的唯一事实来源。
export const piiRegions = readdirSync(new URL('../../assets/text-policy/pii/', import.meta.url))
  .filter(file => /^[a-z]{2}-[A-Z]{2}\.json$/.test(file)).map(file => file.slice(0, -5)).sort()
export const piiRegion = z.enum(piiRegions)
export const piiSelector = z.union([z.literal('common'), piiRegion])
// Validate version, identity and bounded rule entries before activation.
// 激活前校验版本、身份和受限的规则条目。
const ruleFile = z.strictObject({
  language: z.string(), version: z.literal('2.0.0'), excludes: z.array(z.string()).optional(),
  rules: z.array(z.strictObject({ name: z.string().trim().min(1).max(100), pattern: z.string().min(1).max(4096),
    replacement: z.string().max(1024), condition: z.string().max(2048).nullish() })).max(128),
})

/** Parse and compile one rule file, rejecting ambiguous names and invalid capture references.
 *  解析并编译单个规则文件，拒绝歧义名称及无效捕获引用。 */
export function compilePiiFile(selector: string, source: string) {
  const file = ruleFile.parse(JSON.parse(source))
  if (file.language !== selector) throw new Error('The PII rule language must match the selected file.')
  const names = new Set<string>()
  return { excludes: file.excludes ?? [], rules: file.rules.map(rule => {
    if (names.has(rule.name)) throw new Error('PII rule names must be unique within a file.')
    names.add(rule.name)
    const regex = rulePattern(rule.pattern)
    const count = regex.groupCount() + 1
    for (const reference of rule.replacement.matchAll(/\$(\d+)/g)) {
      if (Number(reference[1]) >= count) throw new Error('PII replacement references an unknown capture.')
    }
    return { ...rule, regex, applies: compileCondition(rule.condition ?? '', count) }
  }) }
}

// Preserve DSH-specific credential masking in addition to the upstream rule files.
// 在上游规则文件之外保留 DSH 自有的凭据脱敏。
const basicRules: ReadonlyArray<readonly [string, RegExp]> = [
  ['DSH_PRIVATE_KEY', /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi],
  ['DSH_AUTH_TOKEN', /\b(?:Bearer|Auth)\s+[\w.~/+=-]{12,}/gi],
  ['DSH_CREDENTIAL', /\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi],
  ['DSH_EMAIL', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
]

/** Apply the built-in DSH credential masks and optionally count actual replacements.
 *  应用内置 DSH 凭据规则，可选统计实际替换次数。 */
export function maskBasic(text: string, counts?: Map<string, number>): string {
  for (const [name, regex] of basicRules) {
    text = text.replace(regex, () => {
      counts?.set(name, (counts.get(name) ?? 0) + 1)
      return '[redacted]'
    })
  }
  return text
}

/** Compile a common-plus-region snapshot, preserving common rule order on replacement.
 *  编译通用加地区的快照，同名覆盖时保留通用规则顺序。 */
export function compilePii(region: string, common: string, regional: string) {
  const base = compilePiiFile('common', common)
  const local = compilePiiFile(region, regional)
  const rules = [...new Map([...base.rules, ...local.rules].map(rule => [rule.name, rule])).values()]
  const digest = createHash('sha256').update(JSON.stringify(['pii-v3', region, common, regional])).digest('hex')
  const excludes = new Set([...base.excludes, ...local.excludes])
  return { digest, excludes, rules }
}

// Keep the most recent immutable snapshot per region, including active overrides.
// 每个地区缓存最近一份不可变快照，包含生效覆盖。
const snapshots = new Map<string, { common: string; regional: string; snapshot: ReturnType<typeof compilePii> }>()
const defaults = new Map<string, string>()

/** Load the shipped file once so repeated runtime redaction avoids filesystem I/O.
 *  只读取一次随包文件，避免运行时多次脱敏反复访问文件系统。 */
export function defaultPii(selector: string): string {
  let text = defaults.get(selector)
  if (text === undefined) {
    text = bundledRules('pii', piiSelector.parse(selector))
    defaults.set(selector, text)
  }
  return text
}

/** Get a compiled snapshot for the exact effective common and regional files.
 *  获取准确的通用及地区生效文件所对应的编译快照。 */
export function piiSnapshot(region: string, common = defaultPii('common'), regional = defaultPii(region)) {
  let cached = snapshots.get(region)
  if (cached === undefined || cached.common !== common || cached.regional !== regional) {
    cached = { common, regional, snapshot: compilePii(region, common, regional) }
    snapshots.set(region, cached)
  }
  return cached.snapshot
}

// Describe the immutable privacy settings for a preview, transaction or inference request.
// 描述一次预览、事务或推理请求所用的不可变隐私设置。
export type PiiSnapshot = ReturnType<typeof piiSnapshot>

/** Apply the given rules and report counts, with bounded Unicode-safe replacement output.
 *  执行给定规则并报告命中次数，约束替换输出并保证 Unicode 安全。 */
export function redactText(text: string, policy: string | PiiSnapshot) {
  const snapshot = typeof policy === 'string' ? piiSnapshot(policy) : policy
  const counts = new Map<string, number>()
  if (text !== '') for (const rule of snapshot.rules) {
    const matcher = rule.regex.matcher(text)
    const fragments: string[] = []
    let cursor = 0
    let size = 0
    let count = 0
    while (matcher.find()) {
      const captures = Array.from({ length: matcher.groupCount() + 1 }, (_, index) => matcher.group(index) ?? undefined)
      const before = text.slice(cursor, matcher.start())
      const applies = rule.applies(captures)
      const replacement = applies ? rule.replacement.replace(/\$(\d+)/g, (_, index: string) => captures[Number(index)] ?? '') : captures[0]!
      if (applies) count++
      size += before.length + replacement.length
      if (size > 262_144) throw new Error('PII replacement output is too large.')
      fragments.push(before, replacement)
      cursor = matcher.end()
    }
    if (count > 0) {
      text = fragments.join('') + text.slice(cursor)
      if (text.length > 262_144) throw new Error('PII replacement output is too large.')
      counts.set(rule.name, count)
    }
  }
  return { text: maskBasic(text, counts), matches: [...counts.keys()],
    redactions: [...counts].map(([name, count]) => ({ name, count })) }
}

/** Mask cloud business values and preserve only validated DSH references.
 *  脱敏云端业务值，仅保留已验证的 DSH 结构引用。 */
export function redactPayload(value: unknown, policy: string | PiiSnapshot, field?: string): unknown {
  if (typeof value === 'string') {
    if ((field === 'id' || field === 'memory_id') && z.uuid().safeParse(value).success) return value
    if ((field === 'turn_id' || field === 'source_turn_id') && /^[\w-]+\/\d+$/.test(value)) return value
    if (field === 'bind_id' && (value === 'user' || value === 'project')) return value
    if ((field === 'datetime' || field?.endsWith('_datetime')) && z.iso.datetime().safeParse(value).success) return value
    const text = redactText(value, policy).text
    return field === 'texts' ? text.slice(0, 4200) : text
  }
  if (Array.isArray(value)) return value.map(item => redactPayload(item, policy, field))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactPayload(item, policy, key)]))
}
