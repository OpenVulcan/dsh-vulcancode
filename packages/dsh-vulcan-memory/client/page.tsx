/**
 * The long-term memory page the sidebar opens: memory mode, then one tab per scope, as
 * VulcanCode's memory area (`markdown-memory-area.tsx`) arranges them. Scope tabs are shown only
 * in Markdown mode, since only Markdown memory is kept in these files.
 */

import { useState } from 'react'

import type { Key, Translate } from './i18n'
import { ModeTab } from './mode'
import { ScopeTab } from './scope'
import { SCOPES, type MemoryMode, type MemorySettingsView } from './shared'

type Tab = 'mode' | 'user' | 'space' | 'project'

export function MemoryPage({ t }: { t: Translate }) {
  const [tab, setTab] = useState<Tab>('mode')
  const [mode, setMode] = useState<MemoryMode | undefined>(undefined)
  const tabs: readonly Tab[] = mode === 'markdown' ? ['mode', ...SCOPES] : ['mode']
  const onSettings = (settings: MemorySettingsView) => {
    setMode(settings.mode)
    if (settings.mode !== 'markdown') setTab('mode')
  }
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
        {tab === 'mode' ? null : <ScopeTab key={tab} scope={tab} t={t} />}
      </div>
    </div>
  )
}
