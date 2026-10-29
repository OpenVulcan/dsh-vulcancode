/**
 * Host half of the VulcanCode look for dsh. The look itself runs in the browser (`client/`); the
 * Host only owns the settings, because dsh persists third-party theme choices nowhere else.
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'vulcan-style'

/**
 * What the user chose; mirrored by `THEME_CHOICES` in `client/shared.ts`.
 *
 * - `vulcan-auto`: Vulcan light or dark, following the system colour scheme.
 * - `vulcan-light` / `vulcan-dark` / `vulcan-command`: that Vulcan theme.
 * - `dsh`: leave the theme to dsh's own Appearance setting. Picking a dsh theme in dsh's Appearance
 *   row records this choice.
 */
export const THEME_CHOICES = ['vulcan-auto', 'vulcan-light', 'vulcan-dark', 'vulcan-command', 'dsh'] as const
export type ThemeChoice = typeof THEME_CHOICES[number]

/**
 * Every field is volatile: dsh's settings forms expose only volatile fields, and the browser applies
 * a change without restarting the plugin.
 */
export interface Config {
  theme: Volatile<ThemeChoice>
  squareCorners: Volatile<boolean>
}

export const Config = Schema.object({
  theme: Schema.union(THEME_CHOICES)
    .default('vulcan-auto')
    .description('Interface theme.')
    .volatile(),
  squareCorners: Schema.boolean()
    .default(true)
    .description('Square corners.')
    .volatile(),
}).i18n({
  en: {
    theme: {
      $desc: 'Interface theme. vulcan-auto follows the system light or dark scheme; dsh leaves the theme to dsh\'s Appearance setting.',
      $inner: ['Vulcan, following the system', 'Vulcan light', 'Vulcan dark', 'Vulcan command', 'dsh theme'],
    },
    squareCorners: 'Square corners; works with any theme, dsh\'s own included.',
  },
  zh: {
    theme: {
      $desc: '界面主题。vulcan-auto 跟随系统明暗；dsh 表示由 dsh 的「外观」设置决定。',
      $inner: ['Vulcan，跟随系统', 'Vulcan 亮色', 'Vulcan 暗色', 'Vulcan 指挥舱', 'dsh 主题'],
    },
    squareCorners: '直角外观，可与任何主题搭配，包括 dsh 自带主题。',
  },
})

/** Nothing runs on the Host; the browser half reads and writes this plugin's settings. */
export function apply(_ctx: Context, _config: Config): void {}
