/**
 * Browser half of the dsh plugin: the VulcanCode look for the whole dsh web interface.
 *
 * - Registers the Vulcan light, dark and command themes and applies the stored choice on load.
 * - Stacks the square-corner token layer over any theme, dsh's own included.
 * - Adds a "Vulcan style" row to Settings › General, right after dsh's Appearance row, and the same
 *   form as this row's configuration page on the Plugins page.
 *
 * The choice lives in this plugin's settings because dsh persists only its built-in themes.
 *
 * dsh loads these files as one lazy factory; they may import only modules dsh serves to plugins.
 */

import { installThemeSync, settingsWriter } from './controller'
import type { ClientContext, RowConfigProps } from './dsh-client'
import { en, zh } from './i18n'
import { StyleRow, type StyleRowInjected } from './settings'
import { ENTRY_ID, NAMESPACE, ROW_CONFIG_KEY, type StyleSettings } from './shared'
import { installStyle } from './style'

export const inject = ['slots', 'locale', 'remote', 'configForms', 'theme']

/**
 * The row's configuration on the Plugins page: the description as its one-liner, the settings row as its page.
 * The page passes its own `form` prop (a snapshot without subscription), so the live form travels in a closure.
 */
const rowConfig = (injected: StyleRowInjected) => function RowConfig({ view, t }: RowConfigProps) {
  return view === 'summary' ? t('description') : <StyleRow {...injected} t={t} />
}

export function apply(ctx: ClientContext): void {
  const form = ctx.configForms.get<StyleSettings>(ENTRY_ID)
  const injected: StyleRowInjected = { form, writer: settingsWriter(form) }

  ctx.effect(() => installStyle(), 'vulcan-style: stylesheet')
  ctx.effect(() => ctx.locale.register(NAMESPACE, { zh, en }), 'vulcan-style: dictionaries')
  ctx.effect(() => installThemeSync(ctx, form), 'vulcan-style: themes')

  // dsh's Appearance row is order 10 and its font rows 11.
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'vulcan-style',
    order: 10.5,
    locale: NAMESPACE,
    inject: () => injected,
  }, StyleRow))
  // The Plugins page renders no form of its own; it shows this entry when the row's configure control is opened.
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config',
    key: ROW_CONFIG_KEY,
    locale: NAMESPACE,
    inject: () => ({}),
  }, rowConfig(injected)))
}
