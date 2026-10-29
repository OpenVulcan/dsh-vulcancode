/**
 * Browser half of the account plugin: Settings › OpenVulcan account, and the VulcanCode suite's
 * entry on the Plugins page. dsh loads these files as one lazy factory; they may import only
 * modules dsh serves to plugins.
 */

import { en, NAMESPACE, zh, type Translate } from './i18n'
import { AccountFooter } from './footer'
import { AccountPage, PluginPageSummary } from './page'
import { callAccount, HostWatch, SETTINGS_SECTION, SUITE_PACKAGE, type AccountProfile, type AccountView } from './shared'
import { installStyle } from './style'
import type { ClientContext, SettingsShell, SidebarFooterActionProps } from './dsh-client'

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  const view = new HostWatch<AccountView | null>(() => callAccount<AccountView>('GET', 'state').catch(() => null))
  // An unreadable profile leaves the footer naming the site instead.
  const profile = new HostWatch<AccountProfile | null>(() => callAccount<AccountProfile>('GET', 'profile').catch(() => null))
  const open = (section: string): void => {
    const shell = ctx.slots.entries('sidebar.settings')[0]?.store?.create() as SettingsShell | undefined
    shell?.actions.openSection(section)
  }

  ctx.effect(() => installStyle(), 'openvulcan-account: stylesheet')
  ctx.effect(() => ctx.locale.register(NAMESPACE, { zh, en }), 'openvulcan-account: dictionaries')
  ctx.effect(() => {
    const stop = ctx.on('connection/reset', () => {
      view.refresh()
      profile.refresh()
    })
    return () => {
      stop()
      view.close()
      profile.close()
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
  // Above Settings in the sidebar foot.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register<{ view: HostWatch<AccountView | null>; profile: HostWatch<AccountProfile | null>; open: () => void }>({
    name: 'sidebar.footer.action',
    id: 'openvulcan-account',
    order: 0,
    locale: NAMESPACE,
    inject: () => ({ view, profile, open: () => { open(SETTINGS_SECTION) } }),
  }, ({ wide, t, view: watched, profile: who, open: openSettings }) => (
    <AccountFooter wide={wide} t={t as Translate} view={watched} profile={who} openSettings={openSettings} />
  )))
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register<{ open: (section: string) => void }>({
    name: 'plugins.bundle.config',
    key: SUITE_PACKAGE,
    locale: NAMESPACE,
    inject: () => ({ open }),
  }, PluginPageSummary))
}
