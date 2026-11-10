// The client bundle ID matches the suite dependency's package name.
// 客户端包标识与套件依赖的包名一致。
export const PACKAGE_NAME = '@openvulcan/dsh-vulcan-reasoning'

// The settings namespace and provider-card key registered by dsh's pi-ai adapter.
// dsh 的 pi-ai 适配器注册的设置命名空间及提供商卡片键。
export const PI_AI_NAMESPACE = 'llm-pi-ai'

// The level keys accepted by both supported dsh pi-ai schemas, in escalation order.
// 两个受支持的 dsh pi-ai 模式接受的级别键，按思考强度递增排列。
export const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

// One selector level accepted by the native pi-ai adapter.
// 原生 pi-ai 适配器接受的一个选择器级别。
export type Level = typeof LEVELS[number]

// The native model field. An omitted field inherits the catalog, false disables reasoning.
// 原生模型字段。省略时沿用模型目录，false 表示不提供思考。
export type Efforts = false | Readonly<Partial<Record<Level, string | null>>>

// A model entry in providers.<route>.models. Other fields must survive a catalog write.
// providers.<路由>.models 中的一项。写入目录时必须保留其余字段。
export interface ConfiguredModel {
  readonly id: string
  readonly name?: string
  readonly reasoningEfforts?: Efforts
  readonly [field: string]: unknown
}

// The two catalog forms the native adapter accepts for a provider profile.
// 原生适配器对一个提供商配置接受的两种模型目录形式。
export interface PiAiProfile {
  readonly models?: readonly ConfiguredModel[]
  readonly modelOverrides?: Readonly<Record<string, { readonly reasoningEfforts?: Efforts }>>
  readonly reasoning?: Level
}

// The displayed identity of a model, read from the configured list or dsh's catalog.
// 从配置列表或 dsh 模型目录读取的模型显示标识。
export interface ModelIdentity {
  readonly id: string
  readonly name: string
}

// One model option and its stored reasoning configuration, if any.
// 一个模型选项及其可能已有的思考配置。
export interface ModelOption extends ModelIdentity {
  readonly efforts: Efforts | undefined
}

// The native settings operation sent with the last-read namespace revision.
// 携带最近一次读取的命名空间版本发送的原生设置操作。
export type SettingsOp = { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }

// The modes of the form, separate from the model catalog's wire representation.
// 表单的三种模式，独立于模型目录中的传输表示。
export type Mode = 'inherit' | 'disabled' | 'custom'

// The form stores enabled levels as keys and keeps their input text before validation.
// 表单以键保存已启用的级别，并在校验前保留原始输入文本。
export interface Draft {
  readonly mode: Mode
  readonly values: Readonly<Partial<Record<Level, string>>>
}

// Validation yields either a writable field value or a localized form error key.
// 校验结果为可写入的字段值，或用于本地化的表单错误键。
export type Encoded = { readonly ok: true; readonly value: Efforts | undefined }
  | { readonly ok: false; readonly issue: 'levelRequired' | 'wireRequired' | 'providerDefault' }

/**
 * Read a provider profile by its exact route ID from the pi-ai namespace's effective value.
 * 从 pi-ai 命名空间的生效配置中按准确路由标识读取提供商配置。
 */
export function profileOf(value: unknown, provider: string): PiAiProfile | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  // Only this registered namespace has the providers dictionary described by the adapter.
  // 只有此已注册的命名空间具有适配器定义的 providers 字典。
  const config = value as { readonly providers?: Readonly<Record<string, PiAiProfile>> }
  // Catalog IDs are dictionary keys and must resolve to a stored own entry.
  // 目录标识是字典键，只能解析为配置中自身拥有的条目。
  const profiles = config.providers
  return typeof profiles === 'object' && profiles !== null && Object.hasOwn(profiles, provider) ? profiles[provider] : undefined
}

/**
 * List configured models when the profile replaces the catalog, or pair inherited models with their overrides.
 * 配置替换模型目录时列出配置模型，否则为继承的模型附上对应的覆盖项。
 */
export function modelOptions(profile: PiAiProfile, catalog: readonly ModelIdentity[]): ModelOption[] {
  // The adapter treats an empty models array as inheritance.
  // 适配器将空的 models 数组视为继承模型目录。
  const configured = profile.models
  if (configured !== undefined && configured.length > 0) {
    return configured.map(model => ({ id: model.id, name: model.name ?? model.id, efforts: model.reasoningEfforts }))
  }
  // Overrides are keyed by the exact inherited model ID.
  // 覆盖项以继承模型的准确标识为键。
  const overrides = profile.modelOverrides
  return catalog.map(model => ({
    ...model,
    efforts: overrides !== undefined && Object.hasOwn(overrides, model.id) ? overrides[model.id]?.reasoningEfforts : undefined,
  }))
}

/**
 * Convert the stored native field into the editor's mode and per-level text inputs.
 * 将原生存储字段转换为编辑器的模式与各级别文本输入。
 */
export function draftOf(efforts: Efforts | undefined): Draft {
  if (efforts === undefined) return { mode: 'inherit', values: {} }
  if (efforts === false) return { mode: 'disabled', values: {} }
  // A present off level with a null wire value is edited as an enabled blank input.
  // 已启用但传输值为 null 的 off 级别，在表单中显示为已启用的空输入。
  const values: Partial<Record<Level, string>> = {}
  for (const level of LEVELS) {
    // An absent key keeps the level unchecked.
    // 未配置的键在表单中保持未勾选。
    const wire = efforts[level]
    if (wire !== undefined) values[level] = wire ?? ''
  }
  return { mode: 'custom', values }
}

/**
 * Validate a draft and its compatibility with the provider default, returning the native field.
 * 校验草稿及其与提供商默认级别的兼容性，并返回对应的原生字段。
 */
export function encodeDraft(draft: Draft, providerDefault?: Level): Encoded {
  if (draft.mode === 'inherit') return { ok: true, value: undefined }
  // pi-ai falls back to the provider default when a request has no explicit effort.
  // 请求未指定思考级别时，pi-ai 会使用提供商默认级别。
  if (providerDefault !== undefined) {
    if (draft.mode === 'disabled' && providerDefault !== 'off') return { ok: false, issue: 'providerDefault' }
    if (draft.mode === 'custom' && draft.values[providerDefault] === undefined) return { ok: false, issue: 'providerDefault' }
  }
  if (draft.mode === 'disabled') return { ok: true, value: false }
  if (!LEVELS.some(level => level !== 'off' && draft.values[level] !== undefined)) {
    return { ok: false, issue: 'levelRequired' }
  }
  // A declaration must give each enabled thinking level its exact wire spelling.
  // 自定义配置必须为每个已启用的思考级别提供准确的传输值。
  const values: Partial<Record<Level, string | null>> = {}
  for (const level of LEVELS) {
    // Trim the entered value and omit unchecked levels.
    // 修剪用户输入，并省略未勾选的级别。
    const wire = draft.values[level]?.trim()
    if (wire === undefined) continue
    if (wire === '' && level !== 'off') return { ok: false, issue: 'wireRequired' }
    values[level] = wire === '' ? null : wire
  }
  return { ok: true, value: values }
}

/**
 * Build the native write for one model ID in a provider profile, preserving all unrelated fields.
 * 为提供商配置中的一个模型标识生成原生写操作，并保留所有无关字段。
 */
export function reasoningOp(profile: PiAiProfile, provider: string, modelId: string, efforts: Efforts | undefined): SettingsOp {
  // The pi-ai provider directory addresses each profile by this path.
  // pi-ai 提供商目录按此路径定位各提供商配置。
  const path = ['providers', provider]
  // Use the whole current list for explicit models. dsh replaces arrays between layers.
  // 显式配置的模型使用当前完整列表，因为 dsh 在配置层之间替换数组。
  const models = profile.models
  if (models !== undefined && models.length > 0) {
    if (!models.some(model => model.id === modelId)) throw new Error('The configured model is no longer available')
    return {
      op: 'set',
      path: [...path, 'models'],
      value: models.map(model => {
        if (model.id !== modelId) return model
        // Remove only the old reasoning field so inheritance uses the installed catalog.
        // 仅移除旧的思考字段，使继承模式使用已安装的模型目录。
        const { reasoningEfforts: _previous, ...rest } = model
        return efforts === undefined ? rest : { ...rest, reasoningEfforts: efforts }
      }),
    }
  }
  // The adapter permits sparse overrides only when the model list is inherited.
  // 适配器仅在继承模型列表时允许稀疏覆盖项。
  const field = [...path, 'modelOverrides', modelId, 'reasoningEfforts']
  return efforts === undefined ? { op: 'unset', path: field } : { op: 'set', path: field, value: efforts }
}
