/**
 * Browser half of the account plugin: Settings › OpenVulcan account, and the VulcanCode suite's
 * entry on the Plugins page. dsh loads these files as one lazy factory; they may import only
 * modules dsh serves to plugins.
 */

import { en, NAMESPACE, zh, type Translate } from './i18n'
import { AccountPage, PluginPageSummary } from './page'
import { callAccount, HostWatch, SETTINGS_SECTION, SUITE_PACKAGE, type AccountView } from './shared'
import { installStyle } from './style'
import type { ClientContext, SettingsShell } from './dsh-client'

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  const view = new HostWatch<AccountView | null>(() => callAccount<AccountView>('GET', 'state').catch(() => null))
  const open = (section: string): void => {
    const shell = ctx.slots.entries('sidebar.settings')[0]?.store?.create() as SettingsShell | undefined
    shell?.actions.openSection(section)
  }

  ctx.effect(() => installStyle(), 'openvulcan-account: stylesheet')
  ctx.effect(() => ctx.locale.register(NAMESPACE, { zh, en }), 'openvulcan-account: dictionaries')
  ctx.effect(() => {
    const stop = ctx.on('connection/reset', () => { view.refresh() })
    return () => {
      stop()
      view.close()
    }
  }, 'openvulcan-account: Host state')

  // After Auto approval (22), before Market (40).
  ctx.slots.inject('settings.section', () => ctx.slots.register<{ view: HostWatch<AccountView | null> }>({
    name: 'settings.section',
    id: SETTINGS_SECTION,
    order: 24,
    label: () => ctx.locale.bind(NAMESPACE)('nav'),
    locale: NAMESPACE,
    inject: () => ({ view }),
  }, ({ t, view: injected }) => <AccountPage view={injected} t={t as Translate} />))
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register<{ open: (section: string) => void }>({
    name: 'plugins.bundle.config',
    key: SUITE_PACKAGE,
    locale: NAMESPACE,
    inject: () => ({ open }),
  }, PluginPageSummary))
}
