/**
 * The long-term memory page the sidebar opens: memory mode, then one tab per scope, as
 * VulcanCode's memory area (`markdown-memory-area.tsx`) arranges them. SQLite has its own record editor.
 * 按 VulcanCode 的记忆区组织标签，SQLite 使用独立的记录编辑器。
 */

import { useCallback, useState } from 'react'

import type { Key, Translate } from './i18n'
import { ModeTab } from './mode'
import { ScopeTab } from './scope'
import { SqlitePage } from './sqlite'
import { SCOPES, type MemoryMode, type MemorySettingsView } from './shared'

// The SQLite tab opens structured records without sharing Markdown editors.
// SQLite 标签页打开结构化记录，使用专用编辑器。
type Tab = 'mode' | 'user' | 'space' | 'project' | 'sqlite' | 'models'

export function MemoryPage({ t }: { t: Translate }) {
  const [tab, setTab] = useState<Tab>('mode')
  const [mode, setMode] = useState<MemoryMode | undefined>(undefined)
  // Preserve the active tab when a settings refresh reports the same mode.
  // 设置刷新返回同一模式时保留当前标签。
  const tabs: readonly Tab[] = mode === 'markdown' ? ['mode', ...SCOPES] : mode === 'sqlite' ? ['mode', 'models', 'sqlite'] : ['mode']
  /** Adopt saved mode and navigate to the VMM setup when it has just been selected.
   *  应用已保存模式，刚切换到 VMM 时打开设置。 */
  const onSettings = useCallback((settings: MemorySettingsView, openModels = false) => {
    setMode(settings.mode)
    setTab(active => {
      if (openModels) return 'models'
      if (active === 'mode') return active
      const vmmTab = active === 'sqlite' || active === 'models'
      if (settings.mode === 'sqlite' ? vmmTab : settings.mode === 'markdown' && !vmmTab) return active
      return 'mode'
    })
  }, [])
  return (
    <div className="vac vmm-panel">
      <div className="vac vac-page vmm-panel-inner">
        <div className="vac-page-head">
          <h2>{t('panel')}</h2>
          <p className="vac-lead">{t('page.lead')}</p>
        </div>
        <div className="vmm-tabs" role="tablist">
          {tabs.map(name => (
            <button key={name} type="button" role="tab" aria-selected={tab === name} className={tab === name ? 'vmm-tab on' : 'vmm-tab'}
              onClick={() => { setTab(name) }}>
              {t(`nav.${name}` as Key)}
            </button>
          ))}
        </div>
        {/* The mode tab stays mounted, so its unsaved draft survives a look at a scope. */}
        <div hidden={tab !== 'mode'}><ModeTab t={t} onSettings={onSettings} /></div>
        {tab === 'sqlite' || tab === 'models' ? <SqlitePage t={t} tab={tab} /> : tab === 'mode' ? null : <ScopeTab key={tab} scope={tab} t={t} />}
      </div>
    </div>
  )
}
