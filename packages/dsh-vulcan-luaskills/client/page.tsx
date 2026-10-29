/**
 * The LuaSkills page the sidebar opens: installed skills, and the LuaSkills Hub. Without the
 * runtime both tabs can be looked at, and every action points at the install in Settings.
 */

import { useEffect, useState, type FormEvent } from 'react'

import { fill, type Key, type Translate } from './i18n'
import { useRuntime } from './runtime'
import {
  callHost, isInstalled, messageOf, type ApplyResult, type HostWatch, type HubDetail, type HubPage, type HubSkill,
  type RuntimeView, type SkillRow,
} from './shared'

type Tab = 'installed' | 'hub'

export function LuaSkillsPage({ view, t, openSettings }: { view: HostWatch<RuntimeView | null>; t: Translate; openSettings: () => void }) {
  const live = useRuntime(view)
  const [tab, setTab] = useState<Tab>('installed')
  const ready = live?.state.kind === 'ready'
  // Installed skills, read again after every change; shared with the Hub tab's installed marks.
  const [skills, setSkills] = useState<readonly SkillRow[] | undefined>(undefined)
  const [skillsError, setSkillsError] = useState<string | undefined>(undefined)
  const [generation, setGeneration] = useState(0)
  const reload = () => { setGeneration(value => value + 1) }
  useEffect(() => {
    if (live == null || !isInstalled(live.state)) {
      setSkills([])
      return undefined
    }
    let current = true
    callHost<SkillRow[]>('GET', 'skills').then((rows) => {
      if (!current) return
      setSkills(rows)
      setSkillsError(undefined)
    }, (failure: unknown) => {
      if (current) setSkillsError(messageOf(failure))
    })
    return () => { current = false }
  }, [live?.state.kind, generation])

  return (
    <div className="vac vls-panel">
      <div className="vac vac-page vls-panel-inner">
        <div className="vac-page-head">
          <h2>{t('panel')}</h2>
          <p className="vac-lead">{t('page.lead')}</p>
        </div>
        {live === undefined ? <p className="vac-hint">{t('loading')}</p> : null}
        {live === null ? <div className="vac-alert bad">{t('unavailable')}</div> : null}
        {live != null && !ready ? (
          <div className="vls-banner warn">
            <p className="vac-hint">{live.state.kind === 'installing' || live.state.kind === 'starting' ? t(`runtime.${live.state.kind === 'starting' ? 'starting' : `phase.${live.state.phase}`}` as Key) : t('page.needRuntime')}</p>
            <button type="button" className="vac-btn primary" onClick={openSettings}>{t('page.openSettings')}</button>
          </div>
        ) : null}
        <div className="vls-tabs" role="tablist">
          {(['installed', 'hub'] as const).map(name => (
            <button key={name} type="button" role="tab" aria-selected={tab === name} className={tab === name ? 'vls-tab on' : 'vls-tab'} onClick={() => { setTab(name) }}>
              {t(`tab.${name}` as Key)}
            </button>
          ))}
        </div>
        {/* Both stay mounted, so Hub results survive a look at the installed list. */}
        <div hidden={tab !== 'installed'}>
          <Installed skills={skills} error={skillsError} ready={ready} reload={reload} t={t} />
        </div>
        <div hidden={tab !== 'hub'}>
          <Hub live={live ?? null} ready={ready} installed={skills ?? []} reload={reload} view={view} t={t} />
        </div>
      </div>
    </div>
  )
}

function Installed({ skills, error, ready, reload, t }: {
  skills: readonly SkillRow[] | undefined
  error: string | undefined
  ready: boolean
  reload: () => void
  t: Translate
}) {
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [notes, setNotes] = useState<readonly { readonly ok: boolean; readonly text: string }[]>([])
  const run = (id: string, work: () => Promise<unknown>) => {
    setBusy(id)
    setNotes([])
    work().catch((failure: unknown) => { setNotes([{ ok: false, text: messageOf(failure) }]) }).finally(() => {
      setBusy(undefined)
      reload()
    })
  }
  const update = async (skill: SkillRow): Promise<boolean> => {
    try {
      const result = await callHost<ApplyResult>('POST', `skills/update?id=${encodeURIComponent(skill.skillId)}`)
      setNotes(list => [...list, { ok: true, text: fill(t('installed.result'), { name: skill.name, message: result.message }) }])
      return true
    } catch (failure) {
      setNotes(list => [...list, { ok: false, text: fill(t('installed.result'), { name: skill.name, message: messageOf(failure) }) }])
      return false
    }
  }
  // One after another, stopping at the first failure, as VulcanCode does.
  const updateAll = () => {
    setBusy('*')
    setNotes([])
    void (async () => {
      for (const skill of skills ?? []) {
        if (skill.source === undefined) continue
        if (!await update(skill)) break
      }
    })().finally(() => {
      setBusy(undefined)
      reload()
    })
  }

  if (skills === undefined) return <p className="vac-hint">{t('loading')}</p>
  return (
    <section className="vac-section">
      <div className="vac-section-head">
        <div><h3 className="vac-section-title">{t('tab.installed')}</h3></div>
        <span className="vac-inline">
          <button type="button" className="vac-btn sm" disabled={busy !== undefined} onClick={reload}>{t('installed.refresh')}</button>
          <button type="button" className="vac-btn sm" disabled={!ready || busy !== undefined || skills.length === 0} onClick={updateAll}>{t('installed.updateAll')}</button>
        </span>
      </div>
      <div className="vac-section-body flush">
        {error === undefined ? null : <p className="vac-error vls-pad">{error}</p>}
        {skills.length === 0 ? <p className="vac-hint vls-pad">{t('installed.empty')}</p> : null}
        <ul className="vls-list">
          {skills.map(skill => (
            <li key={`${skill.root}:${skill.skillId}`} className="vls-row">
              <div className="vls-row-main">
                <div className="vac-inline">
                  <strong>{skill.name}</strong>
                  <span className="vac-hint vac-mono">{skill.version}</span>
                  <span className="vac-badge outline">{t(`installed.layer.${skill.root}` as Key)}</span>
                  {!skill.enabled ? <span className="vac-badge warn">{t('installed.disabled')}</span>
                    : ready && !skill.loaded ? <span className="vac-badge bad">{t('installed.notLoaded')}</span> : null}
                </div>
                <p className="vac-hint vac-mono">
                  {skill.skillId}
                  {skill.source === undefined ? '' : ` · ${skill.source.type}:${skill.source.locator}`}
                  {skill.tools.length === 0 ? '' : ` · ${fill(t('installed.tools'), { count: skill.tools.length })}`}
                </p>
                {skill.tools.length === 0 ? null : <p className="vls-tools vac-mono">{skill.tools.join('  ')}</p>}
              </div>
              <span className="vac-inline">
                <button
                  type="button"
                  className="vac-btn sm"
                  disabled={!ready || busy !== undefined}
                  onClick={() => { run(skill.skillId, () => callHost('POST', `skills/enabled?id=${encodeURIComponent(skill.skillId)}&enabled=${String(!skill.enabled)}`)) }}
                >
                  {skill.enabled ? t('installed.disable') : t('installed.enable')}
                </button>
                {skill.source === undefined ? null : (
                  <button type="button" className="vac-btn sm" disabled={!ready || busy !== undefined} onClick={() => { run(skill.skillId, () => update(skill)) }}>
                    {t('installed.update')}
                  </button>
                )}
                {skill.root !== 'USER' ? null : (
                  <button
                    type="button"
                    className="vac-btn sm ghost danger"
                    disabled={!ready || busy !== undefined}
                    onClick={() => {
                      if (window.confirm(fill(t('installed.uninstallConfirm'), { name: skill.name }))) {
                        run(skill.skillId, () => callHost('POST', `skills/uninstall?id=${encodeURIComponent(skill.skillId)}`))
                      }
                    }}
                  >
                    {t('installed.uninstall')}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {notes.length === 0 ? null : (
          <div className="vls-pad">
            {notes.map((note, index) => <p key={index} className={note.ok ? 'vac-hint' : 'vac-error'}>{note.text}</p>)}
          </div>
        )}
      </div>
    </section>
  )
}

function Hub({ live, ready, installed, reload, view, t }: {
  live: RuntimeView | null
  ready: boolean
  installed: readonly SkillRow[]
  reload: () => void
  view: HostWatch<RuntimeView | null>
  t: Translate
}) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<readonly HubSkill[] | undefined>(undefined)
  const [cursor, setCursor] = useState<string | null>(null)
  const [last, setLast] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [installing, setInstalling] = useState<string | undefined>(undefined)
  const [detail, setDetail] = useState<HubDetail | undefined>(undefined)
  const [switching, setSwitching] = useState(false)
  const lang = t('hubLang')
  const hub = live?.settings.network.officialSkillHubBaseUrl
  const site = live?.hubSites.find(item => item.url === hub)?.site

  // The Hub limits searches per address, so it is asked only on Enter and on "load more".
  const search = (text: string, after: string | null) => {
    setLoading(true)
    setError(undefined)
    const params = new URLSearchParams({ q: text, lang })
    if (after !== null) params.set('cursor', after)
    callHost<HubPage>('GET', `hub/search?${params.toString()}`).then((page) => {
      setItems(previous => (after === null ? page.items : [...previous ?? [], ...page.items]))
      setCursor(page.nextCursor)
      setLast(text)
    }, (failure: unknown) => { setError(messageOf(failure)) }).finally(() => { setLoading(false) })
  }
  // A new site means a new catalog.
  useEffect(() => {
    setItems(undefined)
    setCursor(null)
  }, [hub])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    search(query, null)
  }
  const install = (skill: HubSkill) => {
    setInstalling(skill.skill_id)
    setError(undefined)
    callHost<ApplyResult>('POST', `skills/install?id=${encodeURIComponent(skill.skill_id)}`).then(
      () => { reload() },
      (failure: unknown) => { setError(messageOf(failure)) },
    ).finally(() => { setInstalling(undefined) })
  }
  const open = (skill: HubSkill) => {
    setError(undefined)
    callHost<HubDetail>('GET', `hub/skill?${new URLSearchParams({ id: skill.skill_id, lang }).toString()}`).then(setDetail, (failure: unknown) => { setError(messageOf(failure)) })
  }
  const switchSite = (url: string) => {
    if (live == null || url === hub) return
    setSwitching(true)
    setError(undefined)
    callHost('POST', 'settings', { ...live.settings, network: { ...live.settings.network, officialSkillHubBaseUrl: url } })
      .catch((failure: unknown) => { setError(messageOf(failure)) })
      .finally(() => {
        setSwitching(false)
        view.refresh()
      })
  }
  const installedIds = new Set(installed.map(skill => skill.skillId))

  return (
    <section className="vac-section">
      <div className="vac-section-head">
        <div>
          <h3 className="vac-section-title">LuaSkills Hub</h3>
          <p className="vac-section-lead vac-mono">{hub}</p>
        </div>
        <span className="vac-inline" title={t('hub.siteHint')}>
          {live?.hubSites.map(item => (
            <button
              key={item.site}
              type="button"
              className={site === item.site ? 'vls-seg on' : 'vls-seg'}
              disabled={switching || !isInstalled(live.state) || live.state.kind === 'starting'}
              onClick={() => { switchSite(item.url) }}
            >
              {t(`hub.site.${item.site}` as Key)}
            </button>
          ))}
          {site === undefined && hub !== undefined ? <span className="vls-seg on">{t('hub.site.custom')}</span> : null}
        </span>
      </div>
      <div className="vac-section-body">
        <form onSubmit={submit}>
          <input className="vls-input vls-search" type="search" placeholder={t('hub.search')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
        </form>
        {error === undefined ? null : <p className="vac-error" role="alert">{error}</p>}
        {items === undefined ? <p className="vac-hint">{loading ? t('loading') : t('hub.idle')}</p> : null}
        {items !== undefined && items.length === 0 ? <p className="vac-hint">{t('hub.empty')}</p> : null}
        {items === undefined || items.length === 0 ? null : (
          <ul className="vls-cards">
            {items.map((skill) => {
              const content = skill.content ?? undefined
              const summary = content?.summary || skill.summary
              const has = installedIds.has(skill.skill_id)
              return (
                <li key={skill.skill_id} className="vls-card">
                  <div className="vac-between">
                    <span className="vac-inline">
                      <strong>{skill.display_name || skill.skill_id}</strong>
                      {skill.latest_version ? <span className="vac-hint vac-mono">{skill.latest_version}</span> : null}
                      {content?.kind === 'translation' ? <span className="vac-badge info" title={t('hub.translatedTitle')}>{t('hub.translated')}</span> : null}
                    </span>
                    <span className="vac-inline">
                      <button type="button" className="vac-btn sm ghost" onClick={() => { open(skill) }}>{t('hub.details')}</button>
                      <button
                        type="button"
                        className="vac-btn sm"
                        disabled={!ready || has || installing !== undefined}
                        onClick={() => { install(skill) }}
                      >
                        {has ? t('hub.installed') : installing === skill.skill_id ? t('hub.installing') : t('hub.install')}
                      </button>
                    </span>
                  </div>
                  <p className="vac-hint vac-mono">{[skill.skill_id, skill.publisher, skill.license].filter(Boolean).join(' · ')}</p>
                  {summary ? <p className="vls-summary">{summary}</p> : null}
                </li>
              )
            })}
          </ul>
        )}
        {cursor === null ? null : (
          <button type="button" className="vac-btn" disabled={loading} onClick={() => { search(last, cursor) }}>{loading ? t('loading') : t('hub.more')}</button>
        )}
      </div>
      {detail === undefined ? null : <HubDetailSheet detail={detail} close={() => { setDetail(undefined) }} t={t} />}
    </section>
  )
}

function HubDetailSheet({ detail, close, t }: { detail: HubDetail; close: () => void; t: Translate }) {
  const content = detail.skill.content ?? detail.original ?? undefined
  const readme = content?.readme || detail.latest.readme
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [close])
  return (
    <div className="vls-sheet" role="dialog" aria-modal="true" aria-label={detail.skill.display_name || detail.skill.skill_id}>
      <div className="vls-sheet-head">
        <div>
          <strong>{detail.skill.display_name || detail.skill.skill_id}</strong>
          <p className="vac-hint vac-mono">{fill(t('hub.version'), { version: detail.latest.version })} · {detail.skill.skill_id}</p>
        </div>
        <button type="button" className="vac-btn sm" onClick={close}>{t('hub.close')}</button>
      </div>
      <div className="vls-sheet-body">
        {content?.intro ? <p>{content.intro}</p> : null}
        {content?.features !== undefined && content.features.length > 0 ? (
          <>
            <h4>{t('hub.features')}</h4>
            <ul>{content.features.map((feature, index) => <li key={index}>{feature}</li>)}</ul>
          </>
        ) : null}
        {detail.skill.repository_url ? (
          <p><a className="vac-link" href={detail.skill.repository_url} target="_blank" rel="noopener noreferrer">{t('hub.repository')}</a></p>
        ) : null}
        {readme ? (
          <>
            <h4>{t('hub.readme')}</h4>
            <pre className="vls-readme">{readme}</pre>
          </>
        ) : null}
      </div>
    </div>
  )
}
