/**
 * Browser half of the memory plugin: the long-term memory page in the sidebar's panel list. dsh
 * loads these files as one lazy factory; they may import only modules dsh serves to plugins.
 */

import { en, NAMESPACE, zh, type Translate } from './i18n'
import { MemoryPage } from './page'
import { PANEL_ID } from './shared'
import { installStyle } from './style'
import type { ClientContext, PanelIconProps } from './dsh-client'

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => installStyle(), 'vulcan-memory: stylesheet')
  ctx.effect(() => ctx.locale.register(NAMESPACE, { zh, en }), 'vulcan-memory: dictionaries')

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NAMESPACE,
    inject: () => ({}),
  }, ({ t }) => <MemoryPage t={t as Translate} />))
  // After Scheduled tasks (10) and LuaSkills (20).
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 30,
    locale: NAMESPACE,
    label: () => ctx.locale.bind(NAMESPACE)('panel'),
  }, PanelIcon))
}

/** A notebook with a bookmark: notes kept across conversations. */
function PanelIcon({ size }: PanelIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6z" />
      <path d="M6 3.5v17M9.5 8.5h5.5M9.5 12h5.5" />
      <path d="M13 3.5v4l1.5-1 1.5 1v-4" />
    </svg>
  )
}
