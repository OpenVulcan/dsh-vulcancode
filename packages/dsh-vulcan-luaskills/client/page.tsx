/**
 * The LuaSkills page the sidebar opens: installed skills, and the LuaSkills Hub. Without the
 * runtime both tabs can be looked at, and every action points at the install in Settings.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import { fill, type Key, type Translate } from './i18n'
import { DownloadMirrorSection, ManagedRuntimeSection, useRuntime } from './runtime'
import {
  callHost, isInstalled, messageOf, type ApplyResult, type HostWatch, type HubDetail, type HubPage, type HubSkill,
  type RuntimeView, type SkillRow,
} from './shared'

// Skills, catalog and interpreter status share a single LuaSkills page.
// 本地技能、目录和解释器状态共用同一 LuaSkills 页面。
type Tab = 'installed' | 'hub' | 'environment'

/** Render the skills page with a shared runtime view, translations and a Settings shortcut.
 * 使用共享运行状态、翻译函数和设置入口渲染技能页面。 */
export function LuaSkillsPage({ view, t, openSettings }: { view: HostWatch<RuntimeView | null>; t: Translate; openSettings: () => void }) {
  const live = useRuntime(view)
  const [tab, setTab] = useState<Tab>('installed')
  // Load the Hub on its first visit and keep it mounted so returning preserves the page.
  // 首次打开 Hub 时加载，切换标签后保留当前页。
  const [hubVisited, setHubVisited] = useState(false)
  const ready = live?.state.kind === 'ready'
  // Recheck sign-in and sign-out while the automatic Hub view is open.
  // 自动 Hub 页面打开时重新检查登录和退出状态。
  const followsAccount = live?.settings.network.officialSkillHubBaseUrl === null
  useEffect(() => {
    if (tab !== 'hub' || !followsAccount) return
    const timer = setInterval(() => { view.refresh() }, 3000)
    return () => { clearInterval(timer) }
  }, [tab, followsAccount, view])
  // Installed skills, read again after every change; shared with the Hub tab's installed marks.
  const [skills, setSkills] = useState<readonly SkillRow[] | undefined>(undefined)
  const [skillsError, setSkillsError] = useState<string | undefined>(undefined)
  const [generation, setGeneration] = useState(0)
  // An earlier catalog response must not overwrite a newly updated card.
  // 较早的目录响应不得覆盖刚更新的卡片。
  const listRequest = useRef(0)
  const reload = () => { setGeneration(value => value + 1) }
  /** Replace only the updated card with the installed manifest returned by the host.
   *  使用主机返回的已安装清单替换对应卡片。 */
  const replaceSkill = (row: SkillRow) => {
    ++listRequest.current
    setSkills(current => current?.map(skill => skill.root === row.root && skill.skillId === row.skillId ? row : skill))
  }
  useEffect(() => {
    if (live == null || !isInstalled(live.state)) {
      setSkills([])
      return undefined
    }
    let current = true
    const sequence = ++listRequest.current
    callHost<SkillRow[]>('GET', 'skills').then((rows) => {
      if (!current || sequence !== listRequest.current) return
      setSkills(rows)
      setSkillsError(undefined)
    }, (failure: unknown) => {
      if (current && sequence === listRequest.current) setSkillsError(messageOf(failure))
    })
    return () => { current = false }
  }, [live?.state.kind, generation])

  return (
    <div className="vac vls-panel">
      <div className="vac vac-page vls-panel-inner" data-vulcan-settings-width="full">
        <header className="vac-page-head" data-vulcan-settings-header>
          <h2>{t('panel')}</h2>
          <p className="vac-lead">{t('page.lead')}</p>
        </header>
        {live === undefined ? <p className="vac-hint">{t('loading')}</p> : null}
        {live === null ? <div className="vac-alert bad">{t('unavailable')}</div> : null}
        {live != null && !ready ? (
          <div className="vls-banner warn">
            <p className="vac-hint">{live.state.kind === 'installing' || live.state.kind === 'starting' ? t(`runtime.${live.state.kind === 'starting' ? 'starting' : `phase.${live.state.phase}`}` as Key) : t('page.needRuntime')}</p>
            <button type="button" className="vac-btn primary" onClick={openSettings}>{t('page.openSettings')}</button>
          </div>
        ) : null}
        <div className="vls-tabs" role="tablist">
          {(['installed', 'hub', 'environment'] as const).map(name => (
            <button key={name} type="button" role="tab" aria-selected={tab === name} className={tab === name ? 'vls-tab on' : 'vls-tab'} onClick={() => {
              if (name === 'hub') setHubVisited(true)
              setTab(name)
            }}>
              {t(`tab.${name}` as Key)}
            </button>
          ))}
        </div>
        <div hidden={tab !== 'installed'}>
          <Installed skills={skills} error={skillsError} ready={ready} reload={reload} replaceSkill={replaceSkill} t={t} />
        </div>
        <div hidden={tab !== 'hub'}>
          {hubVisited && live != null ? (
            <Hub key={JSON.stringify([live.hubUrl, t('hubLang')])}
              live={live} ready={ready} installed={skills ?? []} reload={reload} view={view} t={t} />
          ) : null}
        </div>
        {tab !== 'environment' || live == null ? null : <>
          <DownloadMirrorSection view={view} live={live} t={t} />
          <ManagedRuntimeSection view={view} live={live} t={t} />
        </>}
      </div>
    </div>
  )
}

function Installed({ skills, error, ready, reload, replaceSkill, t }: {
  skills: readonly SkillRow[] | undefined
  error: string | undefined
  ready: boolean
  reload: () => void
  replaceSkill: (row: SkillRow) => void
  t: Translate
}) {
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [notes, setNotes] = useState<readonly { readonly ok: boolean; readonly text: string }[]>([])
  // Update state follows the card being processed, including entries in a bulk update.
  // 更新状态跟随正在处理的卡片，也覆盖批量更新中的每个条目。
  const [updating, setUpdating] = useState<string>()
  const [updateNotes, setUpdateNotes] = useState<Record<string, { ok: boolean; text: string }>>({})
  const run = (id: string, work: () => Promise<unknown>) => {
    setBusy(id)
    setNotes([])
    work().catch((failure: unknown) => { setNotes([{ ok: false, text: messageOf(failure) }]) }).finally(() => {
      setBusy(undefined)
      reload()
    })
  }
  const update = async (skill: SkillRow): Promise<boolean> => {
    const key = `${skill.root}:${skill.skillId}`
    setUpdating(key)
    try {
      const params = new URLSearchParams({ id: skill.skillId, lang: t('hubLang'), root: skill.root })
      const response = await callHost<{ result: ApplyResult; skill: SkillRow }>('POST', `skills/update?${params}`)
      replaceSkill(response.skill)
      setUpdateNotes(current => ({ ...current, [key]: { ok: true,
        text: t(response.result.status === 'up_to_date' ? 'installed.upToDate' : 'installed.updated') } }))
      return true
    } catch (failure) {
      setUpdateNotes(current => ({ ...current, [key]: { ok: false, text: messageOf(failure) } }))
      return false
    } finally {
      setUpdating(undefined)
    }
  }
  // One after another, stopping at the first failure, as VulcanCode does.
  const updateAll = () => {
    setBusy('*')
    setNotes([])
    setUpdateNotes({})
    void (async () => {
      for (const skill of skills ?? []) {
        if (skill.source === undefined) continue
        if (!await update(skill)) break
      }
    })().finally(() => {
      setBusy(undefined)
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
          {skills.map(skill => {
            const key = `${skill.root}:${skill.skillId}`
            const note = updateNotes[key]
            const pending = updating === key
            return (
            <li key={key} className="vls-row" aria-busy={pending}>
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
                </p>
                <SkillIntroduction skill={skill} locale={t('hubLang')} />
                {pending ? <p className="vac-hint" role="status">{t('installed.updating')}</p> :
                  note === undefined ? null : <p className={note.ok ? 'vac-hint' : 'vac-error'} role={note.ok ? 'status' : 'alert'}>{note.text}</p>}
              </div>
              <div className="vac-inline">
                {skill.tools.length === 0 ? null : <SkillTools tools={skill.tools} t={t} />}
                <button
                  type="button"
                  className="vac-btn sm"
                  disabled={!ready || busy !== undefined}
                  onClick={() => { run(skill.skillId, () => callHost('POST', `skills/enabled?${new URLSearchParams({
                    id: skill.skillId, root: skill.root, enabled: String(!skill.enabled),
                  })}`)) }}
                >
                  {skill.enabled ? t('installed.disable') : t('installed.enable')}
                </button>
                {skill.source === undefined ? null : (
                  <button type="button" className="vac-btn sm" disabled={!ready || busy !== undefined} onClick={() => {
                    setBusy(key)
                    void update(skill).finally(() => { setBusy(undefined) })
                  }}>
                    {t(pending ? 'installed.updating' : 'installed.update')}
                  </button>
                )}
                {skill.root !== 'USER' ? null : (
                  <button
                    type="button"
                    className="vac-btn sm ghost danger"
                    disabled={!ready || busy !== undefined}
                    onClick={() => {
                      if (window.confirm(fill(t('installed.uninstallConfirm'), { name: skill.name }))) {
                        run(skill.skillId, () => callHost('POST', `skills/uninstall?${new URLSearchParams({ id: skill.skillId, root: skill.root })}`))
                      }
                    }}
                  >
                    {t('installed.uninstall')}
                  </button>
                )}
              </div>
            </li>
          )})}
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

/** Display Hub metadata first and resolve descriptions for installs that predate the local cache.
 *  优先显示 Hub 元数据，并补查本地缓存引入前已安装的 Hub 技能介绍。 */
function SkillIntroduction({ skill, locale }: { skill: SkillRow; locale: string }) {
  const [fetched, setFetched] = useState<string | null>(null)
  useEffect(() => {
    setFetched(null)
    if (skill.source?.type !== 'official_hub' || skill.hubSummary !== undefined) return
    let active = true
    const params = new URLSearchParams({ id: skill.skillId, root: skill.root, lang: locale })
    void callHost<string | null>('GET', `skills/description?${params}`).then(value => {
      if (active) setFetched(value)
    }, () => {})
    return () => { active = false }
  }, [skill.skillId, skill.root, skill.source?.type, skill.version, skill.hubSummary, locale])
  const text = skill.hubSummary ?? fetched ?? skill.description
  return text === undefined ? null : <p className="vls-summary">{text}</p>
}

/** Show registered tool names on pointer hover or keyboard focus.
 *  在鼠标悬停或键盘聚焦时显示已注册工具名称。 */
function SkillTools({ tools, t }: { tools: readonly string[]; t: Translate }) {
  const tooltip = useId()
  const [dismissed, setDismissed] = useState(false)
  return <div className="vls-tool-trigger" onMouseEnter={() => { setDismissed(false) }}
    onFocus={() => { setDismissed(false) }} onKeyDown={event => { if (event.key === 'Escape') setDismissed(true) }}>
    <button type="button" className="vac-btn sm" aria-describedby={dismissed ? undefined : tooltip}>
      {t('installed.toolButton')} · {tools.length}
    </button>
    {dismissed ? null : <div id={tooltip} role="tooltip" className="vls-tool-tip">
      <ul>{tools.map(tool => <li key={tool}><code>{tool}</code></li>)}</ul>
    </div>}
  </div>
}

/** Store the submitted query, cursor history and the page being requested.
 * 保存已提交的关键词、游标历史及当前请求的页码。 */
interface CatalogRequest {
  /** Submitted query used for all pages in this search.
   * 此次搜索所有页面共用的已提交关键词。 */
  readonly query: string
  /** Ordered cursor history, starting with a null cursor for the first page.
   * 按页排列的游标历史，第一页的游标为 null。 */
  readonly cursors: readonly (string | null)[]
  /** Zero-based page index into the cursor history.
   * 游标历史中的页码索引，从零开始。 */
  readonly index: number
}

/** Associate a page or request failure with the navigation that produced it.
 * 将页面结果或请求错误关联到对应的翻页或搜索操作。 */
type CatalogResponse =
  | { readonly request: CatalogRequest; readonly page: HubPage }
  | { readonly request: CatalogRequest; readonly error: string }

/** Browse the selected site, showing one page of results with detail and installation actions.
 * 浏览当前站点，每次显示一页，并提供详情与安装操作。
 * The runtime view supplies the catalog site, installed IDs determine badges, and reload and view.refresh update host state.
 * 运行状态提供当前站点，已安装技能决定徽标，reload 与 view.refresh 刷新宿主状态。 */
function Hub({ live, ready, installed, reload, view, t }: {
  live: RuntimeView
  ready: boolean
  installed: readonly SkillRow[]
  reload: () => void
  view: HostWatch<RuntimeView | null>
  t: Translate
}) {
  const [query, setQuery] = useState('')
  // An empty query lists the catalog. Navigation replaces this request and starts a fetch.
  // 空关键词用于浏览完整目录。搜索或翻页时替换请求以触发加载。
  const [request, setRequest] = useState<CatalogRequest>({ query: '', cursors: [null], index: 0 })
  const [response, setResponse] = useState<CatalogResponse | undefined>(undefined)
  // Render only the response belonging to the navigation currently on screen.
  // 只渲染与当前搜索或翻页操作对应的结果。
  const result = response?.request === request ? response : undefined
  const page = result !== undefined && 'page' in result ? result.page : undefined
  const loading = result === undefined
  const [error, setError] = useState<string | undefined>(undefined)
  const [installing, setInstalling] = useState<string | undefined>(undefined)
  const [detail, setDetail] = useState<HubDetail | undefined>(undefined)
  const [switching, setSwitching] = useState(false)
  const lang = t('hubLang')
  const hub = live.hubUrl
  const configured = live.settings.network.officialSkillHubBaseUrl
  const site = live.hubSites.find(item => item.url === hub)?.site

  useEffect(() => {
    // Ignore responses from a superseded request or a Hub that has switched sites.
    // 忽略已被替换的请求，以及站点切换前尚未返回的请求。
    let current = true
    const params = new URLSearchParams({ q: request.query, lang, hub })
    const cursor = request.cursors[request.index]
    if (typeof cursor === 'string') params.set('cursor', cursor)
    void callHost<HubPage>('GET', `hub/search?${params.toString()}`).then((page) => {
      if (current) setResponse({ request, page })
    }, (failure: unknown) => {
      if (current) setResponse({ request, error: messageOf(failure) })
    })
    return () => { current = false }
  }, [hub, lang, request])

  /** Start a new search at the first page using the supplied text.
   * 使用传入的关键词发起新搜索，从第一页开始。 */
  const search = (text: string) => {
    setError(undefined)
    setRequest({ query: text.trim(), cursors: [null], index: 0 })
  }
  /** Submit the current search field and return to the first page.
   * 提交当前搜索框内容，并回到第一页。 */
  const submit = (event: FormEvent) => {
    event.preventDefault()
    search(query)
  }
  /** Move back using the cursor previously recorded for that page.
   * 使用该页此前记录的游标向前翻页。 */
  const previous = () => {
    setRequest({ ...request, index: request.index - 1 })
  }
  /** Move forward using the current response's opaque cursor.
   * 使用本页响应返回的不透明游标向后翻页。 */
  const next = (cursor: string) => {
    setRequest({ ...request, cursors: [...request.cursors.slice(0, request.index + 1), cursor], index: request.index + 1 })
  }
  /** Install the selected Hub skill and refresh the installed badges on success.
   * 安装选中的 Hub 技能，成功后刷新已安装标记。 */
  const install = (skill: HubSkill) => {
    setInstalling(skill.skill_id)
    setError(undefined)
    const summary = [skill.content?.intro, skill.content?.summary, skill.summary]
      .find(text => typeof text === 'string' && text.trim() !== '')
    callHost<ApplyResult>('POST', `skills/install?${new URLSearchParams({ id: skill.skill_id, hub, lang })}`, summary?.trim().slice(0, 16_384) ?? null).then(
      () => { reload() },
      (failure: unknown) => { setError(messageOf(failure)) },
    ).finally(() => { setInstalling(undefined) })
  }
  /** Open the selected skill's details in the current Hub language.
   * 按当前 Hub 语言打开所选技能的详情。 */
  const open = (skill: HubSkill) => {
    setError(undefined)
    callHost<HubDetail>('GET', `hub/skill?${new URLSearchParams({ id: skill.skill_id, lang, hub }).toString()}`).then(setDetail, (failure: unknown) => { setError(messageOf(failure)) })
  }
  /** Save the target site's URL and refresh the shared runtime view.
   * 保存目标站点地址并刷新共享运行状态。 */
  const switchSite = (url: string | null) => {
    if (url === configured) return
    setSwitching(true)
    setError(undefined)
    callHost('POST', 'hub/site', url)
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
          <button type="button" className={configured === null ? 'vls-seg on' : 'vls-seg'}
            disabled={switching || live.state.kind === 'installing' || live.state.kind === 'starting'}
            onClick={() => { switchSite(null) }}>{t('hub.site.auto')}</button>
          {live.hubSites.map(item => (
            <button
              key={item.site}
              type="button"
              className={configured === item.url ? 'vls-seg on' : 'vls-seg'}
              disabled={switching || live.state.kind === 'installing' || live.state.kind === 'starting'}
              onClick={() => { switchSite(item.url) }}
            >
              {t(`hub.site.${item.site}` as Key)}
            </button>
          ))}
          {site === undefined ? <span className="vls-seg on">{t('hub.site.custom')}</span> : null}
        </span>
      </div>
      <div className="vac-section-body">
        <form className="vls-search-form" role="search" onSubmit={submit}>
          <input className="vls-input vls-search" type="search" aria-label={t('hub.search')} placeholder={t('hub.search')}
            value={query} onChange={(event) => { setQuery(event.target.value) }} />
          <button type="submit" className="vac-btn" disabled={switching}>{t('hub.searchButton')}</button>
          {query !== '' || request.query !== '' ? (
            <button type="button" className="vac-btn" disabled={switching} onClick={() => {
              setQuery('')
              search('')
            }}>{t('hub.clear')}</button>
          ) : null}
        </form>
        {error === undefined ? null : <p className="vac-error" role="alert">{error}</p>}
        {loading ? <p className="vac-hint" role="status">{t('loading')}</p> : null}
        {result !== undefined && 'error' in result ? (
          <div className="vac-inline">
            <p className="vac-error" role="alert">{result.error}</p>
            <button type="button" className="vac-btn sm" disabled={switching} onClick={() => { setRequest({ ...request }) }}>
              {t('hub.retry')}
            </button>
          </div>
        ) : null}
        {page?.items.length === 0 ? <p className="vac-hint" role="status">{t(request.query === '' ? 'hub.empty' : 'hub.noMatches')}</p> : null}
        {page === undefined || page.items.length === 0 ? null : (
          <ul className="vls-cards">
            {page.items.map((skill) => {
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
                      <button type="button" className="vac-btn sm ghost" disabled={switching} onClick={() => { open(skill) }}>{t('hub.details')}</button>
                      <button
                        type="button"
                        className="vac-btn sm"
                        disabled={!ready || has || installing !== undefined || switching}
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
        {page !== undefined || request.index > 0 ? (
          <nav className="vac-inline vls-pagination" aria-label={t('hub.pagination')}>
            <button type="button" className="vac-btn sm" disabled={request.index === 0 || loading || switching} onClick={previous}>
              {t('hub.previous')}
            </button>
            <span className="vac-hint vac-mono" aria-live="polite">{fill(t('hub.page'), { page: request.index + 1 })}</span>
            <button type="button" className="vac-btn sm" disabled={page?.nextCursor == null || switching}
              onClick={() => { if (page?.nextCursor != null) next(page.nextCursor) }}>
              {t('hub.next')}
            </button>
          </nav>
        ) : null}
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
