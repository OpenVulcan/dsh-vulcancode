import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { piiRegion } from './pii.js'
export { maskBasic, redactPayload, redactText } from './pii.js'

// Select from the bundled regional rules and independently configure both noise stages.
// 从随包发布的地区规则中选择，并独立配置两级噪声过滤。
export const textPolicySchema = z.strictObject({
  region: piiRegion,
  noise: z.boolean(),
  semanticNoise: z.boolean(),
})
export type TextPolicy = z.infer<typeof textPolicySchema>
export const DEFAULT_TEXT_POLICY: TextPolicy = { region: 'zh-CN', noise: true, semanticNoise: true }

// Read the versioned VulcanCode rule resources included with the plugin.
// 读取插件随附的 VulcanCode 版本化规则资源。
const resourceRoot = new URL('../../assets/text-policy/', import.meta.url)
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
