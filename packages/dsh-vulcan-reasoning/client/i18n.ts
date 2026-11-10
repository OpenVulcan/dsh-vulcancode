// Labels for the per-model editor in dsh's interface language.
// 随 dsh 界面语言切换的每模型编辑器文案。
export const NAMESPACE = 'vulcan-reasoning'

// Chinese copy for the provider card and all form states.
// 提供商卡片及各表单状态的中文文案。
export const zh = {
  title: '自定义思考级别',
  lead: '为当前模型设置对话中可选的思考级别，以及提供商实际接收的值。传输值以模型接口支持的参数为准。',
  loading: '正在读取模型配置…',
  loadFailed: '读取模型配置失败',
  saveFailed: '保存失败',
  conflict: '模型配置已被其他操作修改。请重新读取后再保存。',
  readonly: '当前设置为只读。',
  empty: '此提供商没有可编辑的模型。',
  reload: '重新读取',
  model: '模型',
  mode: '思考配置',
  inherit: '跟随模型目录',
  disabled: '关闭思考',
  custom: '自定义级别',
  wire: '接口传输值',
  offHint: '关闭级别可留空',
  levelRequired: '请至少启用一个思考级别。',
  wireRequired: '每个已启用的思考级别都需要填写接口传输值。',
  providerDefault: '必须保留提供商的默认级别',
  save: '保存思考配置',
  saving: '保存中…',
  saved: '思考配置已保存。',
  reselect: '已有会话若选中了已移除的级别，请在输入框的模型选择器中重新选择。',
}

// The keys shared by both dictionaries.
// 两份词典共同使用的键。
export type Key = keyof typeof zh

// Translate one editor key into the interface language.
// 将一个编辑器文案键翻译为当前界面语言。
export type Translate = (key: Key) => string

// English copy mirrors the Chinese dictionary.
// 英文文案与中文词典保持同样的键。
export const en: Record<Key, string> = {
  title: 'Custom thinking levels',
  lead: 'Choose the thinking levels offered in conversations and the value sent for each level. Use wire values supported by the model endpoint.',
  loading: 'Reading model settings…',
  loadFailed: 'Could not read model settings',
  saveFailed: 'Could not save',
  conflict: 'The model settings changed. Reload them before saving again.',
  readonly: 'The current settings are read-only.',
  empty: 'This provider has no editable models.',
  reload: 'Reload',
  model: 'Model',
  mode: 'Thinking configuration',
  inherit: 'Follow the model catalog',
  disabled: 'Disable thinking',
  custom: 'Custom levels',
  wire: 'Wire value',
  offHint: 'Leave blank for off',
  levelRequired: 'Enable at least one thinking level.',
  wireRequired: 'Enter a wire value for every enabled thinking level.',
  providerDefault: 'Keep the provider’s default thinking level',
  save: 'Save thinking configuration',
  saving: 'Saving…',
  saved: 'Thinking configuration saved.',
  reselect: 'If an existing conversation uses a removed level, select the model and level again in the composer.',
}
