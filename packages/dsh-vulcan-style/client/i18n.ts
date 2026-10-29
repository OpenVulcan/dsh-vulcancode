/** The plugin's interface text; dsh picks the dictionary that matches its interface language. */

export const zh = {
  'title': 'Vulcan 界面风格',
  'description': 'VulcanCode 的配色与直角外观。选择「使用 dsh 主题」时，由 dsh 的「外观」设置决定明暗。',
  'choice.vulcan-auto': '跟随系统',
  'choice.vulcan-light': '亮色',
  'choice.vulcan-dark': '暗色',
  'choice.vulcan-command': '指挥舱',
  'choice.dsh': '使用 dsh 主题',
  'square.title': '直角',
  'square.description': '把界面的圆角改为直角，可与任何主题搭配，包括 dsh 自带主题。',
  'saveFailed': '未能保存设置。',
  'readOnly': '当前配置为只读，无法修改。',
} as const

export type Key = keyof typeof zh

export const en: Readonly<Record<Key, string>> = {
  'title': 'Vulcan style',
  'description': 'VulcanCode colours and square corners. With "Use dsh theme", the Appearance setting of dsh decides light or dark.',
  'choice.vulcan-auto': 'Follow system',
  'choice.vulcan-light': 'Light',
  'choice.vulcan-dark': 'Dark',
  'choice.vulcan-command': 'Command',
  'choice.dsh': 'Use dsh theme',
  'square.title': 'Square corners',
  'square.description': 'Draw the interface with square corners; works with any theme, dsh\'s own included.',
  'saveFailed': 'The setting could not be saved.',
  'readOnly': 'The configuration is read-only.',
}

export type Translate = (key: Key) => string
