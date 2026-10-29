/** The plugin's interface text; dsh picks the dictionary that matches its interface language. */

export const NAMESPACE = 'vulcan-answers'

export const zh = {
  'severity.high': '高',
  'severity.medium': '中',
  'severity.low': '低',
  'severity.info': '提示',
  'column.severity': '严重度',
  'column.finding': '发现',
  'column.location': '位置',
  'copyMarkdown': '复制为 Markdown',
  'copyData': '复制数据',
  'copied': '已复制',
  'chartView': '图表',
  'dataView': '数据',
  'fileCount': '{count} 个文件',
  'overBy': '超出 {percent}%',
  'mark.added': '新增',
  'mark.changed': '变更',
  'mark.removed': '删除',
  'decision.multiple': '可多选',
  'decision.recommended': '建议',
  'decision.note': '补充说明（可选）',
  'decision.insert': '插入输入框',
  'decision.send': '发送',
  'decision.combined': '共 {count} 项决策一起提交',
  'decision.readOnly': '找不到这条回答所在会话的输入框，选项只读。',
  'decision.insertFailed': '输入框正忙或草稿已改变，未能插入。',
  'reply.decisions': '决策',
  'reply.noChoice': '未选择',
  'mode.label': '回答',
  'mode.interactive': '交互',
  'mode.standard': '标准',
  'mode.title': '回答模式',
  'mode.interactive.hint': '回答以 ui-* 组件呈现：表格、图表、流程图、决策等。',
  'mode.standard.hint': '回答使用普通 Markdown。',
  'mode.next': '从下一次请求开始生效。',
  'mode.draft': '会话开始后才能切换；首条消息使用默认模式。',
  'mode.failed': '切换失败：{error}',
} as const

export type Key = keyof typeof zh

export const en: Record<Key, string> = {
  'severity.high': 'High',
  'severity.medium': 'Medium',
  'severity.low': 'Low',
  'severity.info': 'Info',
  'column.severity': 'Severity',
  'column.finding': 'Finding',
  'column.location': 'Location',
  'copyMarkdown': 'Copy as Markdown',
  'copyData': 'Copy data',
  'copied': 'Copied',
  'chartView': 'Chart',
  'dataView': 'Data',
  'fileCount': '{count} files',
  'overBy': '{percent}% over',
  'mark.added': 'Added',
  'mark.changed': 'Changed',
  'mark.removed': 'Removed',
  'decision.multiple': 'Multiple choice',
  'decision.recommended': 'Recommended',
  'decision.note': 'Add a note (optional)',
  'decision.insert': 'Insert into composer',
  'decision.send': 'Send',
  'decision.combined': '{count} decisions go together',
  'decision.readOnly': 'The composer of this answer\'s session is not on screen, so the options are read-only.',
  'decision.insertFailed': 'The composer is busy or its draft changed; nothing was inserted.',
  'reply.decisions': 'Decisions',
  'reply.noChoice': 'no choice',
  'mode.label': 'Answers',
  'mode.interactive': 'Interactive',
  'mode.standard': 'Standard',
  'mode.title': 'Answer mode',
  'mode.interactive.hint': 'Answers use ui-* components: tables, charts, diagrams, decisions.',
  'mode.standard.hint': 'Answers use plain Markdown.',
  'mode.next': 'Applies from the next request.',
  'mode.draft': 'Switchable once the session starts; the first message uses the default mode.',
  'mode.failed': 'Switching failed: {error}',
}

/** Text of one key in the current interface language. */
export type Translate = (key: Key) => string

/** Fill `{name}` placeholders. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/gu, (whole, name: string) => (name in values ? String(values[name]) : whole))
}
