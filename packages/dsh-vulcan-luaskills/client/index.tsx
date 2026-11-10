/**
 * Browser half of the LuaSkills plugin: Settings › LuaSkills (runtime and VM settings), and the
 * LuaSkills page in the sidebar's panel list (installed skills and the Hub). dsh loads these files
 * as one lazy factory; they may import only modules dsh serves to plugins.
 */

import { en, NAMESPACE, zh, type Translate } from './i18n'
import { LuaSkillsPage } from './page'
import { SettingsPage } from './settings'
import { callHost, HostWatch, PANEL_ID, SETTINGS_SECTION, type RuntimeView } from './shared'
import { installStyle } from './style'
import type { ClientContext, PanelIconProps, SettingsShell } from './dsh-client'

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  const view = new HostWatch<RuntimeView | null>(() => callHost<RuntimeView>('GET', 'state').catch(() => null))
  const openSettings = (): void => {
    const shell = ctx.slots.entries('sidebar.settings')[0]?.store?.create() as SettingsShell | undefined
    shell?.actions.openSection(SETTINGS_SECTION)
  }

  ctx.effect(() => installStyle(), 'vulcan-luaskills: stylesheet')
  ctx.effect(() => ctx.locale.register(NAMESPACE, { zh, en }), 'vulcan-luaskills: dictionaries')
  ctx.effect(() => {
    const stop = ctx.on('connection/reset', () => { view.refresh() })
    return () => {
      stop()
      view.close()
    }
  }, 'vulcan-luaskills: Host state')

  // After the OpenVulcan account (24), before Market (40).
  ctx.slots.inject('settings.section', () => ctx.slots.register<{ view: HostWatch<RuntimeView | null> }>({
    name: 'settings.section',
    id: SETTINGS_SECTION,
    order: 26,
    label: () => ctx.locale.bind(NAMESPACE)('nav'),
    locale: NAMESPACE,
    inject: () => ({ view }),
  }, ({ t, view: injected }) => <SettingsPage view={injected} t={t as Translate} />))
  // dsh 0.2.2 declares this optional slot. The injection waits on older hosts.
  // dsh 0.2.2 声明了此可选插槽，旧版宿主上的注入会保持等待。
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon',
    id: SETTINGS_SECTION,
  }, LuaSkillsIcon))
  ctx.slots.inject('main', () => ctx.slots.register<{ view: HostWatch<RuntimeView | null>; openSettings: () => void }>({
    name: 'main',
    key: PANEL_ID,
    locale: NAMESPACE,
    inject: () => ({ view, openSettings }),
  }, ({ t, view: injected, openSettings: open }) => <LuaSkillsPage view={injected} t={t as Translate} openSettings={open} />))
  // After Scheduled tasks (10).
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 20,
    locale: NAMESPACE,
    label: () => ctx.locale.bind(NAMESPACE)('panel'),
  }, LuaSkillsIcon))
}

/**
 * Render the LuaSkills moon and brackets at the size requested by either navigation slot.
 * 按设置或侧栏导航插槽要求的尺寸渲染 LuaSkills 的月亮与括号图标。
 */
function LuaSkillsIcon({ size }: PanelIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="16.2" cy="7.8" r="2.1" />
      <path d="M9.5 9.5 7 12l2.5 2.5M14.5 14.5 17 12" />
    </svg>
  )
}
