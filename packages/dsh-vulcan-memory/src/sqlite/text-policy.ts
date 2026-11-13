import { z } from 'zod'
import { noiseLanguage, noiseThreshold } from './noise.js'
import { piiRegion } from './pii.js'

// Keep old saved policies readable while defaulting to the VulcanCode noise composition.
// 保持旧策略可读取，同时默认使用 VulcanCode 噪声规则组合。
export const textPolicySchema = z.strictObject({
  region: piiRegion,
  noise: z.boolean(),
  semanticNoise: z.boolean(),
  noiseLanguage: noiseLanguage.default('zh-CN'),
  noiseThreshold: noiseThreshold.default(0.88),
})
// Represent the complete effective policy, including defaults for older records.
// 表示完整的生效策略，包含旧记录所需的默认值。
export type TextPolicy = z.output<typeof textPolicySchema>
export const DEFAULT_TEXT_POLICY = textPolicySchema.parse({ region: 'zh-CN', noise: true, semanticNoise: true })
