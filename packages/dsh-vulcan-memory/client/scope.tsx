/**
 * One memory scope (`markdown-scope-page.tsx` and `markdown-node-dialogs.tsx`): the project
 * selector and orphan notice, injection usage, the node tree, the node editor and the whole-file
 * editor. Host projects are dsh workspaces.
 */

import { useCallback, useEffect, useState } from 'react'

import { fill, reasonLabel, type Key, type Translate } from './i18n'
import { Dialog, Section } from './parts'
import {
  SCOPES, callHost, loadOverview, messageOf, nodeTitle, type BudgetPart, type MemoryFile, type MemoryNode, type MemoryOperation,
  type MemoryOverview, type MemoryScope, type MemoryTarget, type ProjectAction,
} from './shared'

const SCOPE_PARTS: Record<MemoryScope, readonly BudgetPart[]> = {
  user: ['user'],
  space: ['spaceBase', 'spaceCatalog'],
  project: ['projectBase', 'projectCatalog'],
}

/** The project tab's choice: a host project, or a memory project without one. */
type Selection = { readonly kind: 'host' | 'memory'; readonly id: string }

type EditorState = { kind: 'add' } | { kind: 'edit'; node: MemoryNode } | { kind: 'move'; node: MemoryNode }

export function ScopeTab({ scope, t }: { scope: MemoryScope; t: Translate }) {
  const [selection, setSelection] = useState<Selection | null | undefined>(scope === 'project' ? undefined : null)
  const target: MemoryTarget = scope !== 'project' || selection == null ? {}
    : selection.kind === 'host' ? { projectId: selection.id } : { memoryProjectId: selection.id }
  const targetKey = JSON.stringify(target)
  const [overview, setOverview] = useState<MemoryOverview | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | undefined>(undefined)
  const [editor, setEditor] = useState<EditorState | undefined>(undefined)
  const [deleting, setDeleting] = useState<MemoryNode | undefined>(undefined)
  const [file, setFile] = useState<MemoryFile | undefined>(undefined)

  const load = useCallback(async () => {
    setLoadError(undefined)
    try {
      const next = await loadOverview(JSON.parse(targetKey) as MemoryTarget)
      setOverview(next)
      // The project tab starts at the first dsh workspace, the closest to VulcanCode's selected project.
      if (selection === undefined) {
        const first = next.hostProjects[0]
        setSelection(first === undefined ? null : { kind: 'host', id: first.id })
      }
    } catch (error) {
      setLoadError(messageOf(error))
    }
  }, [targetKey, selection])
  useEffect(() => {
    setOverview(undefined)
    void load()
  }, [targetKey])

  const fail = (error: unknown) => { setNotice({ ok: false, text: `${t('writeFailed')}: ${messageOf(error)}` }) }
  /** Apply operations as the user and keep the refreshed page; `undefined` when nothing was written. */
  const write = async (operations: MemoryOperation[]): Promise<MemoryOverview | undefined> => {
    setBusy(true)
    setNotice(undefined)
    try {
      const next = await callHost<MemoryOverview>('POST', 'write', { ...target, operations })
      setOverview(next)
      return next
    } catch (error) {
      fail(error)
      return undefined
    } finally {
      setBusy(false)
    }
  }
  const projectAction = async (action: ProjectAction) => {
    setBusy(true)
    setNotice(undefined)
    try {
      await callHost('POST', 'project', action)
      await load()
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
    }
  }
  const shownProjectId = overview?.memoryProjectId ?? null
  const fileProject = scope === 'project' && shownProjectId !== null ? `&memoryProjectId=${encodeURIComponent(shownProjectId)}` : ''
  const openFile = () => {
    callHost<MemoryFile>('GET', `file?scope=${scope}${fileProject}`).then(setFile, (error: unknown) => {
      setNotice({ ok: false, text: `${t('loadFailed')}: ${messageOf(error)}` })
    })
  }
  const saveFile = async (expected: string, text: string): Promise<boolean> => {
    try {
      await callHost('POST', 'file', { scope, ...scope === 'project' && shownProjectId !== null ? { memoryProjectId: shownProjectId } : {}, expected, text })
      setNotice({ ok: true, text: t('file.saved') })
      await load()
      return true
    } catch (error) {
      fail(error)
      return false
    }
  }

  if (loadError !== undefined) {
    return (
      <div className="vac-alert bad vac-between">
        <span>{t('loadFailed')}: {loadError}</span>
        <button type="button" className="vac-btn sm" onClick={() => { void load() }}>{t('retry')}</button>
      </div>
    )
  }
  if (overview === undefined) return <p className="vac-hint">{t('loading')}</p>
  if (scope === 'project' && selection === null && overview.projects.length === 0) {
    return <Section title={t('nav.project')}><p className="vac-hint">{t('project.none')}</p></Section>
  }

  const nodes = overview[scope]
  const shownProject = overview.projects.find(project => project.id === shownProjectId)
  // Writing the project scope needs a bound or chosen memory project, or a host project to bind.
  const projectAvailable = shownProjectId !== null || selection?.kind === 'host'
  const canWrite = scope !== 'project' || projectAvailable
  const hostIds = new Set(overview.hostProjects.map(host => host.id))
  const unhosted = overview.projects.filter(project => !project.hostProjectIds.some(id => hostIds.has(id)))
  const orphan = scope === 'project' && selection?.kind === 'host' ? overview.orphanCandidates[0] : undefined
  const orphanProject = orphan === undefined ? undefined : overview.projects.find(project => project.id === orphan.memoryProjectId)
  const usage = overview.usage.filter(row => SCOPE_PARTS[scope].includes(row.part))
  const warningPercent = overview.settings.warningPercent

  return (
    <>
      {scope !== 'project' ? null : (
        <label className="vmm-field">
          {t('project.select')}
          <select
            className="vmm-select"
            disabled={busy}
            value={selection == null ? '' : `${selection.kind}:${selection.id}`}
            onChange={(event) => {
              const [kind, ...rest] = event.target.value.split(':')
              setSelection({ kind: kind === 'memory' ? 'memory' : 'host', id: rest.join(':') })
            }}
          >
            {selection == null ? <option value="" disabled>{t('project.select')}</option> : null}
            {overview.hostProjects.map(host => <option key={host.id} value={`host:${host.id}`}>{host.title} — {host.path}</option>)}
            {unhosted.length === 0 ? null : (
              <optgroup label={t('project.otherGroup')}>
                {unhosted.map(project => <option key={project.id} value={`memory:${project.id}`}>{project.name}</option>)}
              </optgroup>
            )}
          </select>
        </label>
      )}

      {orphan !== undefined && orphanProject !== undefined && selection?.kind === 'host' ? (
        <div className="vac-alert info">
          <strong>{t('orphan.title')}</strong>
          <p className="vac-hint">{fill(t('orphan.body'), { name: orphanProject.name, reasons: orphan.reasons.map(reason => reasonLabel(t, reason)).join(', ') })}</p>
          <span className="vac-inline">
            <button type="button" className="vac-btn sm primary" disabled={busy}
              onClick={() => { void projectAction({ action: 'link', projectId: selection.id, memoryProjectId: orphan.memoryProjectId }) }}>{t('orphan.link')}</button>
            <button type="button" className="vac-btn sm" disabled={busy}
              onClick={() => { void projectAction({ action: 'create', projectId: selection.id }) }}>{t('orphan.create')}</button>
            <button type="button" className="vac-btn sm ghost" disabled={busy}
              onClick={() => { void projectAction({ action: 'ignore', projectId: selection.id }) }}>{t('orphan.ignore')}</button>
          </span>
        </div>
      ) : null}
      {scope === 'project' && shownProject !== undefined && !shownProject.memoryEnabled ? <div className="vac-alert warn">{t('project.disabled')}</div> : null}
      {notice === undefined ? null : <div className={notice.ok ? 'vac-alert ok' : 'vac-alert bad'} role="status">{notice.text}</div>}

      {usage.length === 0 ? null : (
        <Section title={t('usage.title')}>
          <div className="vmm-usage">
            {usage.map((row) => {
              const percent = row.budget > 0 ? Math.round(row.tokens * 100 / row.budget) : 0
              const tone = row.tokens > row.budget ? 'bad' : percent >= warningPercent ? 'warn' : 'ok'
              const width = Math.min(100, row.tokens * 100 / Math.max(row.budget, row.tokens, 1))
              return (
                <div key={row.part}>
                  <div className="vmm-usage-head">
                    <span>{t(`part.${row.part}` as Key)}</span>
                    <span>{fill(t('usage.value'), { tokens: row.tokens, budget: row.budget })}</span>
                    {tone === 'bad' ? <span className="vac-badge bad">{t('usage.over')}</span>
                      : tone === 'warn' ? <span className="vac-badge warn">{t('usage.near')}</span> : null}
                  </div>
                  <div className="vmm-bar" role="meter" aria-label={t(`part.${row.part}` as Key)} aria-valuemin={0}
                    aria-valuemax={Math.max(row.budget, row.tokens, 1)} aria-valuenow={row.tokens}>
                    <div className={`vmm-bar-fill ${tone}`} style={{ width: `${width}%` }} />
                  </div>
                  {row.omitted.length === 0 ? null : <p className="vac-hint">{fill(t('usage.omitted'), { titles: row.omitted.join(', ') })}</p>}
                </div>
              )
            })}
            {usage.some(row => row.tokens > row.budget || (row.budget > 0 && row.tokens * 100 >= row.budget * warningPercent))
              ? <p className="vac-hint">{t('usage.curateHint')}</p> : null}
          </div>
        </Section>
      )}

      <Section
        title={t(`nav.${scope}` as Key)}
        lead={scope === 'project' && projectAvailable && shownProjectId === null ? t('project.unbound') : t(`detail.${scope}` as Key)}
        flush
        actions={(
          <>
            <button type="button" className="vac-btn sm" disabled={busy || !canWrite} onClick={() => { setEditor({ kind: 'add' }) }}>{t('node.add')}</button>
            <button type="button" className="vac-btn sm ghost" disabled={busy || (scope === 'project' && shownProjectId === null)} onClick={openFile}>{t('file.edit')}</button>
          </>
        )}
      >
        {nodes.length === 0 ? <p className="vac-hint vmm-pad">{t('nodes.empty')}</p> : (
          <ol className="vmm-tree">
            {nodes.map(node => (
              <NodeRow key={`${node.id}:${node.revision}`} t={t} node={node} busy={busy || !canWrite}
                onEdit={() => { setEditor({ kind: 'edit', node }) }}
                onMove={() => { setEditor({ kind: 'move', node }) }}
                onDelete={() => { setDeleting(node) }} />
            ))}
          </ol>
        )}
      </Section>

      {editor === undefined ? null : (
        <NodeEditor t={t} state={editor} scope={scope} overview={overview} projectAvailable={projectAvailable}
          close={() => { setEditor(undefined) }} submit={write} />
      )}
      {file === undefined ? null : <FileEditor t={t} file={file} close={() => { setFile(undefined) }} save={saveFile} />}
      {deleting === undefined ? null : (
        <Dialog
          title={fill(t('node.deleteConfirm'), { title: nodeTitle(deleting) })}
          lead={deleting.descendants > 0 ? fill(t('node.deleteChildren'), { count: deleting.descendants }) : undefined}
          close={() => { setDeleting(undefined) }}
          footer={(
            <>
              <button type="button" className="vac-btn" onClick={() => { setDeleting(undefined) }}>{t('cancel')}</button>
              <button type="button" className="vac-btn primary danger" onClick={() => {
                const node = deleting
                setDeleting(undefined)
                void write([{ action: 'delete', id: node.id, expectedRevision: node.revision, withChildren: node.descendants > 0 }])
              }}>{t('node.delete')}</button>
            </>
          )}
        >
          <p className="vac-hint">{deleting.path.join(' › ')}</p>
        </Dialog>
      )}
    </>
  )
}

function NodeRow({ t, node, busy, onEdit, onMove, onDelete }: {
  t: Translate
  node: MemoryNode
  busy: boolean
  onEdit: () => void
  onMove: () => void
  onDelete: () => void
}) {
  // The base section anchors the injected part and cannot be moved or deleted.
  const fixed = node.level === 1 && node.section === 'base'
  return (
    <li className="vmm-node" data-level={node.level}>
      <div className="vmm-node-head">
        <strong>{nodeTitle(node)}</strong>
        {fixed ? <span className="vac-badge outline">{t('node.base')}</span> : null}
        {/* Sections are containers, preset ones included, so only notes carry an author badge. */}
        {node.source !== null && node.level > 1 ? (
          <span className="vac-badge outline" title={node.session ?? undefined}>{t(node.source === 'user' ? 'node.sourceUser' : 'node.sourceAi')}</span>
        ) : null}
        {node.updated === null ? null : <small>{fill(t('node.updated'), { time: node.updated })}</small>}
        <span className="vmm-node-acts">
          <button type="button" className="vac-btn sm ghost" disabled={busy} onClick={onEdit}>{t('node.edit')}</button>
          {fixed ? null : (
            <>
              <button type="button" className="vac-btn sm ghost" disabled={busy} onClick={onMove}>{t('node.move')}</button>
              <button type="button" className="vac-btn sm ghost danger" disabled={busy} onClick={onDelete}>{t('node.delete')}</button>
            </>
          )}
        </span>
      </div>
      {node.body === '' ? null : <p className="vmm-node-body">{node.body}</p>}
    </li>
  )
}

/** Destination sections of a scope: existing H1 nodes (`node:<id>`), then presets the file lacks (`preset:<key>`). */
function sectionChoices(overview: MemoryOverview, scope: MemoryScope): { value: string; title: string }[] {
  const roots = overview[scope].filter(node => node.level === 1)
  const existing = new Set(roots.map(node => node.section).filter((key): key is string => key !== null))
  return [
    ...roots.map(node => ({ value: `node:${node.id}`, title: node.path[0] ?? '' })),
    ...overview.presetSections.filter(section => section.scope === scope && !existing.has(section.key))
      .map(section => ({ value: `preset:${section.key}`, title: section.title })),
  ]
}

function placement(value: string): { parentId: string } | { section: string } {
  return value.startsWith('node:') ? { parentId: value.slice('node:'.length) } : { section: value.slice('preset:'.length) }
}

function NodeEditor({ t, state, scope, overview, projectAvailable, close, submit }: {
  t: Translate
  state: EditorState
  scope: MemoryScope
  overview: MemoryOverview
  projectAvailable: boolean
  close: () => void
  submit: (operations: MemoryOperation[]) => Promise<MemoryOverview | undefined>
}) {
  const currentTitle = state.kind === 'add' ? '' : nodeTitle(state.node)
  const [title, setTitle] = useState(currentTitle)
  const [body, setBody] = useState(state.kind === 'edit' ? state.node.body : '')
  const [targetScope, setTargetScope] = useState<MemoryScope>(scope)
  const [section, setSection] = useState(() => sectionChoices(overview, scope)[0]?.value ?? '')
  const [saving, setSaving] = useState(false)

  const choices = sectionChoices(overview, targetScope).filter(choice => state.kind !== 'move' || choice.value !== `node:${state.node.id}`)
  const scopes = SCOPES.filter(item => item !== 'project' || projectAvailable)
  const titleChanged = state.kind === 'edit' && title.trim() !== currentTitle
  const bodyChanged = state.kind === 'edit' && body !== state.node.body
  const valid = state.kind === 'move' ? section !== ''
    : title.trim() !== '' && (state.kind === 'add' ? section !== '' : titleChanged || bodyChanged)

  // An edit that changes both parts writes the body first and then renames the refreshed node,
  // because the revision covers the title and the body.
  const save = async () => {
    setSaving(true)
    try {
      if (state.kind === 'add') {
        if (await submit([{ action: 'create', scope, title: title.trim(), body, ...placement(section) }]) !== undefined) close()
        return
      }
      if (state.kind === 'move') {
        if (await submit([{ action: 'move', id: state.node.id, expectedRevision: state.node.revision, scope: targetScope, ...placement(section) }]) !== undefined) close()
        return
      }
      let node: MemoryNode | undefined = state.node
      if (bodyChanged) {
        const next = await submit([{ action: 'replace', id: node.id, expectedRevision: node.revision, body }])
        if (next === undefined) return
        const path = JSON.stringify(node.path)
        node = next[scope].find(candidate => JSON.stringify(candidate.path) === path)
      }
      if (titleChanged && node !== undefined) {
        if (await submit([{ action: 'rename', id: node.id, expectedRevision: node.revision, title: title.trim() }]) === undefined) return
      }
      close()
    } finally {
      setSaving(false)
    }
  }
  const heading = state.kind === 'add' ? t('editor.addTitle') : state.kind === 'move' ? t('editor.moveTitle') : t('editor.editTitle')

  return (
    <Dialog
      title={heading}
      lead={state.kind === 'move' ? currentTitle : undefined}
      busy={saving}
      close={close}
      footer={(
        <>
          <button type="button" className="vac-btn" disabled={saving} onClick={close}>{t('cancel')}</button>
          <button type="button" className="vac-btn primary" disabled={saving || !valid} onClick={() => { void save() }}>{t('save')}</button>
        </>
      )}
    >
      {state.kind !== 'move' ? null : (
        <label className="vmm-field">
          {t('editor.scope')}
          <select className="vmm-select" value={targetScope} disabled={saving} onChange={(event) => {
            const next = event.target.value as MemoryScope
            setTargetScope(next)
            setSection(sectionChoices(overview, next)[0]?.value ?? '')
          }}>
            {scopes.map(item => <option key={item} value={item}>{t(`nav.${item}` as Key)}</option>)}
          </select>
        </label>
      )}
      {state.kind === 'edit' ? null : (
        <label className="vmm-field">
          {t('editor.section')}
          <select className="vmm-select" value={section} disabled={saving || choices.length === 0} onChange={(event) => { setSection(event.target.value) }}>
            {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.title}</option>)}
          </select>
        </label>
      )}
      {state.kind === 'move' ? null : (
        <>
          <label className="vmm-field">
            {t('editor.title')}
            <input className="vmm-input" value={title} disabled={saving} maxLength={120} onChange={(event) => { setTitle(event.target.value) }} />
          </label>
          <label className="vmm-field">
            {t('editor.body')}
            <textarea className="vmm-textarea" rows={8} value={body} disabled={saving} onChange={(event) => { setBody(event.target.value) }} />
          </label>
        </>
      )}
    </Dialog>
  )
}

function FileEditor({ t, file, close, save }: {
  t: Translate
  file: MemoryFile
  close: () => void
  save: (expected: string, text: string) => Promise<boolean>
}) {
  const [text, setText] = useState(file.text)
  const [saving, setSaving] = useState(false)
  const run = async () => {
    setSaving(true)
    try {
      if (await save(file.text, text)) close()
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog
      title={t('file.title')}
      lead={t('file.hint')}
      wide
      busy={saving}
      close={close}
      footer={(
        <>
          <button type="button" className="vac-btn" disabled={saving} onClick={close}>{t('cancel')}</button>
          <button type="button" className="vac-btn primary" disabled={saving || text === file.text} onClick={() => { void run() }}>{t('save')}</button>
        </>
      )}
    >
      <code className="vmm-mono">{file.path}</code>
      <textarea className="vmm-textarea file" spellCheck={false} value={text} disabled={saving} aria-label={t('file.title')}
        onChange={(event) => { setText(event.target.value) }} />
    </Dialog>
  )
}
