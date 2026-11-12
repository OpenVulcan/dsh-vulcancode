import type { Translate } from './i18n'

// Match VulcanCode's physical keys while keeping ordinary typing available.
// 匹配 VulcanCode 的物理按键，并保留普通键入。
const PRIMARY_KEY = /^(?:Key[A-Z]|Digit[0-9]|Space|F(?:[1-9]|1[0-9]|2[0-4]))$/
const MODIFIER_KEY = /^(?:Control|Alt|Shift|Meta)(?:Left|Right)$/
const MODIFIERS = [
  ['ctrlKey', 'Control'], ['altKey', 'Alt'], ['shiftKey', 'Shift'], ['metaKey', 'Meta'],
] as const

// Label physical punctuation and numpad keys independently of keyboard layout.
// 使用与键盘布局无关的标签显示物理标点及数字键盘按键。
const SYMBOLS: Readonly<Partial<Record<string, string>>> = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\',
  IntlRo: '\\', IntlYen: '¥', NumpadAdd: '+', NumpadSubtract: '-', NumpadMultiply: '*',
  NumpadDivide: '/', NumpadDecimal: '.', NumpadEqual: '=', NumpadComma: ',',
}

/**
 * Identify whether the supplied physical code is a left or right modifier.
 * 判断传入的物理键码是否为左侧或右侧修饰键。
 */
export function isModifierCode(code: string): boolean {
  return MODIFIER_KEY.test(code)
}

/**
 * Return the canonical form of a saved binding, or an empty string when invalid.
 * 返回已保存绑定的规范形式，无效时返回空字符串。
 */
export function normalizeShortcut(shortcut: string): string {
  if (isModifierCode(shortcut)) return shortcut
  // Older dsh voice versions stored Ctrl where VulcanCode stores Control.
  // 旧版 dsh 语音以 Ctrl 表示 VulcanCode 的 Control。
  const canonical = shortcut.replace(/^Ctrl\+/, 'Control+')
  const modifiers = canonical.split('+')
  const code = modifiers.pop()
  const ordered = MODIFIERS.map(([, name]) => name).filter(name => modifiers.includes(name))
  return code !== undefined && (PRIMARY_KEY.test(code) || Object.hasOwn(SYMBOLS, code))
    && modifiers.join('+') === ordered.join('+')
    && (code.startsWith('F') || ordered.some(name => name !== 'Shift')) ? canonical : ''
}

/**
 * Return the binding represented by a keydown event, excluding IME and AltGr input.
 * 返回按下事件代表的绑定，排除输入法及 AltGr 输入。
 */
export function shortcutFromKey(event: KeyboardEvent): string {
  if (event.isComposing || event.key === 'AltGraph' || event.getModifierState('AltGraph')) return ''
  const held = MODIFIERS.filter(([field]) => event[field]).map(([, name]) => name)
  if (isModifierCode(event.code)) return held.every(name => event.code.startsWith(name)) ? event.code : ''
  return normalizeShortcut([...held, event.code].join('+'))
}

/**
 * Recognize the release of the saved physical key or a participating chord modifier.
 * 识别已绑定物理键或组合键修饰键的松开。
 */
export function releasesShortcut(shortcut: string, event: KeyboardEvent): boolean {
  if (isModifierCode(shortcut)) return event.code === shortcut
  const parts = shortcut.split('+')
  return parts.includes(event.code) || parts.includes(event.key)
}

/**
 * Format a saved binding with localized sides and readable physical key labels.
 * 使用本地化左右方向与易读物理键名显示已保存的绑定。
 */
export function shortcutLabel(shortcut: string, t: Translate): string {
  if (isModifierCode(shortcut)) {
    const key = shortcut.replace(/(?:Left|Right)$/, '').replace(/^Control$/, 'Ctrl')
    return t(shortcut.endsWith('Left') ? 'shortcutLeft' : 'shortcutRight').replace('{key}', key)
  }
  return shortcut.split('+').map(code => {
    if (code === 'Control') return 'Ctrl'
    const label = SYMBOLS[code] ?? code.replace(/^(?:Key|Digit)(?=[A-Z0-9]$)/, '')
    return code.startsWith('Numpad') ? t('shortcutNumpad').replace('{key}', label) : label
  }).join('+')
}
