import { useCallback, useEffect, useState } from 'react'
import { fill, type Key, type Translate } from './i18n'
import { Dialog, Section, Segments } from './parts'
import { callHost, messageOf, SCOPES, type HostProject, type MemoryScope } from './shared'
import { TextPolicyPanel } from './text-policy'

// Mirror the host record type in the browser bundle.
// 在浏览器包中映射主机端记录类型。
type Entry = { id: string; revision: string; scope: MemoryScope; kind: 'memory' | 'profile'; title: string; body: string }

// Mirror the public status and consent payload exposed by the SQLite route.
// 映射 SQLite 路由公开的状态与同意数据。
interface CloudStatus {
  native: 'unsupported' | 'missing' | 'damaged' | 'installed'
  version: string
  approved: boolean
  automatic: boolean
  hasConsent: boolean
  cloudError: boolean
  offer: {
    consent: { binding: string; id: string; revision: string }
    site: 'cn' | 'global'
    name: string
    profile: boolean
    precheck: boolean
    postaction: boolean
    providers: { capability: string; model: string; provider: string; region: string; data_policy: string; privacy_url: string; purposes?: string[] }[]
  } | null
}

// Hold an unsaved editor draft and its revision when editing an existing row.
// 保存未提交的编辑草稿，编辑已有记录时携带版本。
type Draft = { scope: MemoryScope; title: string; body: string; entry?: Entry }

/** Render local SQLite records, scope selection, search and the free service controls.
 *  渲染本地 SQLite 记录、范围选择、检索和免费服务控制。 */
export function SqlitePage({ t, tab }: { t: Translate; tab: 'sqlite' | 'models' }) {
  // Keep editor and search state apart from the server's record list.
  // 将编辑与检索状态和服务端记录列表分开。
  const [status, setStatus] = useState<CloudStatus>()
  const [projects, setProjects] = useState<HostProject[]>([])
  const [entries, setEntries] = useState<Entry[]>()
  const [results, setResults] = useState<Entry[]>()
  const [project, setProject] = useState('')
  const [kind, setKind] = useState<Entry['kind']>('memory')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [generation, setGeneration] = useState(0)
  const [draft, setDraft] = useState<Draft>()
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  /** Refresh cloud disclosure and native library status from the host.
   *  从主机刷新云端披露信息及原生库状态。 */
  const refresh = useCallback(async () => {
    setStatus(await callHost<CloudStatus>('GET', 'sqlite/status'))
  }, [])
  useEffect(() => {
    void refresh().catch((failure: unknown) => { setError(messageOf(failure)) })
  }, [refresh])
  useEffect(() => {
    if (tab !== 'sqlite') return
    let active = true
    setEntries(undefined)
    const params = new URLSearchParams({ projectId: project, kind, offset: String(offset) })
    void callHost<{ projects: HostProject[]; entries: Entry[] }>('GET', `sqlite/records?${params}`).then(value => {
      if (active) { setProjects(value.projects); setEntries(value.entries) }
    }, (failure: unknown) => {
      if (active) { setEntries([]); setError(messageOf(failure)) }
    })
    return () => { active = false }
  }, [project, kind, offset, generation, tab])

  /** Run a page action with a shared pending state and a readable error.
   *  使用统一的等待状态执行页面操作，并显示可读错误。 */
  const perform = async (label: string, action: () => Promise<void>) => {
    setBusy(label)
    setError('')
    setNotice('')
    try { await action() } catch (failure) { setError(messageOf(failure)) } finally { setBusy('') }
  }

  /** Submit a local or cloud-enabled search for the selected project.
   *  为选中项目提交本地检索或已启用的云端检索。 */
  const search = (semantic: boolean) => perform(semantic ? t('sql.semantic') : t('sql.keyword'), async () => {
    setResults(await callHost<Entry[]>('POST', 'sqlite/search', { projectId: project, query, semantic }))
  })

  /** Close the current draft and clear its delete confirmation and messages.
   *  关闭当前草稿并清除删除确认与消息。 */
  const closeDraft = () => { setDraft(undefined); setDeleting(false); setError(''); setNotice('') }

  /** Commit one record edit against the captured revision and reload its list.
   *  按已获取的版本提交单条记录变更，再刷新列表。 */
  const save = (value: Draft, remove = false) => perform(remove ? t('node.delete') : t('save'), async () => {
    const { entry, scope, title, body } = value
    const operation = entry === undefined ? { action: 'add', kind, scope, title, body }
      : remove ? { action: 'remove', id: entry.id, revision: entry.revision }
        : { action: 'edit', id: entry.id, revision: entry.revision, title, body }
    await callHost('POST', 'sqlite/write', { projectId: project, operation })
    closeDraft()
    setResults(undefined)
    setOffset(0)
    setGeneration(value => value + 1)
  })

  /** Request a suggestion for this profile draft without saving the result.
   *  为当前画像草稿请求建议，返回后等待用户保存。 */
  const suggest = (value: Draft, scope: 'user' | 'project') => perform(t('sql.suggest'), async () => {
    const lines = await callHost<string[]>('POST', 'sqlite/draft', { projectId: project, scope, text: value.body })
    if (lines.length === 0) { setNotice(t('sql.noDraft')); return }
    setDraft({ ...value, body: lines.join('\n').slice(0, 4000) })
    setNotice(t('sql.reviewDraft'))
  })

  // Keep cloud metadata visible alongside the corresponding approval controls.
  // 将云端元数据与对应的同意操作一同展示。
  const offer = status?.offer
  const vectorReady = status?.approved === true && status.native === 'installed'
  const rows = results ?? entries?.slice(0, 50)
  return (
    <>
      {tab === 'sqlite' && <Section title={t('sql.records')} lead={t('sql.recordsHint')}
        actions={<button type="button" className="vac-btn sm primary" disabled={busy !== ''} onClick={() => {
          setDraft({ scope: project === '' ? 'user' : 'project', title: '', body: '' }); setError('')
        }}>{t('node.add')}</button>}>
        <div className="vac-inline">
          <Segments label={t('sql.records')} disabled={busy !== ''} value={kind}
            options={[{ value: 'memory', label: t('sql.memories') }, { value: 'profile', label: t('sql.profiles') }]}
            onChange={(value) => { setKind(value); setOffset(0); setResults(undefined) }} />
          <select className="vmm-input" aria-label={t('project.select')} value={project} disabled={busy !== ''}
            onChange={event => { setProject(event.target.value); setOffset(0); setResults(undefined) }}>
            <option value="">{t('sql.global')}</option>
            {projects.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}
          </select>
        </div>
        {kind === 'memory' && <form className="vac-inline" onSubmit={event => { event.preventDefault(); void search(vectorReady) }}>
          <input className="vmm-input" aria-label={t('sql.query')} placeholder={t('sql.query')} value={query} maxLength={4000}
            disabled={busy !== ''} onChange={event => { setQuery(event.target.value) }} />
          <button type="submit" className={`vac-btn sm${vectorReady ? ' primary' : ''}`}
            disabled={busy !== '' || query.trim() === ''}>{t(vectorReady ? 'sql.semantic' : 'sql.keyword')}</button>
          {vectorReady && <button type="button" className="vac-btn sm"
            disabled={busy !== '' || query.trim() === ''} onClick={() => { void search(false) }}>{t('sql.keyword')}</button>}
          {results !== undefined && <button type="button" className="vac-btn sm" onClick={() => { setResults(undefined) }}>{t('sql.clear')}</button>}
        </form>}
        {rows === undefined ? <p className="vac-hint">{t('loading')}</p> : rows.length === 0 ? <p className="vac-hint">{t('nodes.empty')}</p> :
          <ul className="vmm-list">{rows.map(entry => <li key={entry.id} className="vmm-row">
            <div className="vmm-row-main">
              <strong>{entry.title}</strong>
              <span className="vac-hint">{t(`sql.scope.${entry.scope}`)} · {entry.body.slice(0, 100)}</span>
            </div>
            <button type="button" className="vac-btn sm" disabled={busy !== ''} onClick={() => {
              setDraft({ scope: entry.scope, title: entry.title, body: entry.body, entry }); setError('')
            }}>{t('node.edit')}</button>
          </li>)}</ul>}
        {results === undefined && ((entries?.length ?? 0) > 50 || offset > 0) && <div className="vac-inline">
          <button type="button" className="vac-btn sm" disabled={offset === 0 || busy !== ''} onClick={() => { setOffset(offset - 50) }}>{t('sql.previous')}</button>
          <button type="button" className="vac-btn sm" disabled={(entries?.length ?? 0) < 51 || busy !== ''} onClick={() => { setOffset(offset + 50) }}>{t('sql.next')}</button>
        </div>}
      </Section>}
      {tab === 'models' && <>
      <Section title={t('sql.cloud')} lead={t('sql.cloudHint')} actions={
        <button type="button" className="vac-btn sm" disabled={busy !== ''} onClick={() => { void perform(t('retry'), refresh) }}>{t('retry')}</button>
      }>
        {status === undefined ? <p className="vac-hint">{t('loading')}</p> : <>
          <p className="vac-hint">{t(`sql.native.${status.native}`)} · {status.version}</p>
          {(status.native === 'missing' || status.native === 'damaged') &&
            <button type="button" className="vac-btn sm" disabled={busy !== ''} onClick={() => {
              void perform(t(status.native === 'damaged' ? 'sql.repair' : 'sql.download'),
                async () => { await callHost('POST', 'sqlite/install'); await refresh() })
            }}>{t(status.native === 'damaged' ? 'sql.repair' : 'sql.download')}</button>}
          {offer == null ? <p className="vac-hint">{t(status.cloudError ? 'sql.cloudError' : 'sql.noOffer')}</p> : <>
            <div className="vac-between"><strong>{offer.name} · {t(`sql.site.${offer.site}`)}</strong>
              <span className="vac-badge info">{offer.consent.id}</span></div>
            <ul className="vmm-list">{MODEL_STAGES.map(stage => {
              const provider = offer.providers.find(route => stage === 'embedding' ? route.capability === 'embedding'
                : route.capability === 'inference' && (route.purposes === undefined || route.purposes.includes(stage)))
              return <li key={stage} className="vmm-row">
                <div className="vmm-row-main">
                  <strong>{t(`sql.stage.${stage}` as Key)}</strong>
                  {provider === undefined ? <span className="vac-hint">{t('sql.stageUnavailable')}</span> : <>
                    <span>{provider.provider} · <code>{provider.model}</code></span>
                    <span className="vac-hint">{provider.region} · {provider.data_policy}</span>
                  </>}
                </div>
                {provider !== undefined && <a href={provider.privacy_url} target="_blank" rel="noreferrer">{t('sql.privacy')}</a>}
              </li>
            })}</ul>
            <p className="vac-hint">{t('sql.consentHint')}</p>
            {(!offer.precheck || !offer.postaction) && <p className="vac-hint">{t('sql.partialOffer')}</p>}
            {status.automatic && <p className="vac-hint">{t(status.native === 'installed' ? 'sql.approved' : 'sql.awaitNative')}</p>}
            {!status.automatic && offer.precheck && offer.postaction &&
              <button type="button" className="vac-btn sm primary" disabled={busy !== ''} onClick={() => {
                void perform(t('sql.approve'), async () => {
                  await callHost('POST', 'sqlite/consent', { ...offer.consent, automatic: true })
                  await refresh()
                })
              }}>{t('sql.approve')}</button>}
            {!status.approved && (!offer.precheck || !offer.postaction) &&
              <button type="button" className="vac-btn sm" disabled={busy !== ''} onClick={() => {
                void perform(t('sql.approveManual'), async () => {
                  await callHost('POST', 'sqlite/consent', offer.consent)
                  await refresh()
                })
              }}>{t('sql.approveManual')}</button>}
          </>}
          {status.hasConsent && <button type="button" className="vac-btn sm" disabled={busy !== ''} onClick={() => {
            void perform(t('sql.revoke'), async () => { await callHost('POST', 'sqlite/consent', null); await refresh() })
          }}>{t('sql.revoke')}</button>}
        </>}
      </Section>
      <TextPolicyPanel t={t} />
      </>}
      {draft === undefined ? <>
        {busy !== '' && <p className="vac-hint" role="status">{busy}…</p>}
        {error !== '' && <p className="vac-error" role="alert">{error}</p>}
      </> : <Dialog title={t(draft.entry === undefined ? 'editor.addTitle' : 'editor.editTitle')} close={closeDraft} busy={busy !== ''} wide
        footer={<>
          {draft.entry !== undefined && <button type="button" className="vac-btn sm" disabled={busy !== ''} onClick={() => {
            if (deleting) void save(draft, true)
            else setDeleting(true)
          }}>{deleting ? t('sql.confirmDelete') : t('node.delete')}</button>}
          <button type="button" className="vac-btn sm" disabled={busy !== ''} onClick={closeDraft}>{t('cancel')}</button>
          <button type="button" className="vac-btn sm primary" disabled={busy !== '' || draft.title.trim() === '' || draft.body.trim() === ''}
            onClick={() => { void save(draft) }}>{t('save')}</button>
        </>}>
        <label className="vmm-field">{t('editor.scope')}
          <select className="vmm-input" value={draft.scope} disabled={busy !== '' || draft.entry !== undefined}
            onChange={event => { setDraft({ ...draft, scope: event.target.value as MemoryScope }) }}>
            {SCOPES.map(scope => <option key={scope} value={scope} disabled={scope === 'project' && project === ''}>{t(`sql.scope.${scope}`)}</option>)}
          </select>
        </label>
        <label className="vmm-field">{t('editor.title')}
          <input className="vmm-input" value={draft.title} maxLength={160} disabled={busy !== ''}
            onChange={event => { setDraft({ ...draft, title: event.target.value }) }} />
        </label>
        <label className="vmm-field">{t('editor.body')}
          <textarea className="vmm-input" rows={9} value={draft.body} maxLength={4000} disabled={busy !== ''}
            onChange={event => { setDraft({ ...draft, body: event.target.value }) }} />
        </label>
        {kind === 'profile' && status?.approved === true && offer?.profile === true && draft.scope !== 'space' &&
          <button type="button" className="vac-btn sm" disabled={busy !== '' || draft.body.trim() === ''}
            onClick={() => { if (draft.scope !== 'space') void suggest(draft, draft.scope) }}>{t('sql.suggest')}</button>}
        {deleting && draft.entry !== undefined && <p className="vac-hint">{fill(t('node.deleteConfirm'), { title: draft.entry.title })}</p>}
        {busy !== '' && <p className="vac-hint" role="status">{busy}…</p>}
        {notice !== '' && <p className="vac-hint" role="status">{notice}</p>}
        {error !== '' && <p className="vac-error" role="alert">{error}</p>}
      </Dialog>}
    </>
  )
}

// Label only the stages the DSH implementation actually invokes.
// 只标注 DSH 实际调用的阶段。
const MODEL_STAGES = ['embedding', 'pcl1', 'pcl2', 'ptl1', 'ptl2', 'profile_instruction'] as const
