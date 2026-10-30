/**
 * Import and export (`markdown-memory-transfer.tsx`). VulcanCode picks native folders and files on
 * the Host; the dsh page may run on another machine, so the package is downloaded by the browser
 * on export and read from a browser file on import. The archive bytes go with both the preview and
 * the apply request, and the preview's SHA-256 still binds them together.
 */

import { useEffect, useRef, useState, type ChangeEvent } from 'react'

import { fill, reasonLabel, type Key, type Translate } from './i18n'
import { Dialog, Section, Segments } from './parts'
import {
  callHost, download, fromBase64, loadOverview, messageOf, toBase64, type ConflictChoice, type ExportedPackage, type ImportPreview,
  type ImportReport, type MemoryProject, type NodeConflict, type NodeSide, type ProjectMapping, type ScopeMergePreview,
} from './shared'

const CHOICES: readonly ConflictChoice[] = ['keep_local', 'take_imported', 'keep_both']

/** A package whose import is being reviewed. */
interface OpenImport {
  readonly name: string
  /** Base64 archive bytes, sent with every request. */
  readonly archive: string
  /** Preview without project targets, used for the project step. */
  readonly preview: ImportPreview
  readonly localProjects: readonly MemoryProject[]
}

export function TransferSection({ t, onImported }: { t: Translate; onImported: () => void }) {
  const [exporting, setExporting] = useState(false)
  const [openImport, setOpenImport] = useState<OpenImport | undefined>(undefined)
  const [reading, setReading] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | undefined>(undefined)
  const picker = useRef<HTMLInputElement>(null)

  const inspect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    setReading(true)
    setNote(undefined)
    void (async () => {
      const archive = toBase64(new Uint8Array(await file.arrayBuffer()))
      const [preview, overview] = await Promise.all([
        callHost<ImportPreview>('POST', 'import/preview', { archive, name: file.name, projects: [] }),
        loadOverview({}),
      ])
      setOpenImport({ name: file.name, archive, preview, localProjects: overview.projects })
    })().catch((failure: unknown) => { setNote({ ok: false, text: messageOf(failure) }) }).finally(() => { setReading(false) })
  }

  return (
    <Section
      title={t('transfer.title')}
      lead={t('transfer.hint')}
      actions={(
        <>
          <button type="button" className="vac-btn sm" onClick={() => { setExporting(true) }}>{t('transfer.export')}</button>
          <button type="button" className="vac-btn sm" disabled={reading} onClick={() => { picker.current?.click() }}>
            {reading ? t('transfer.previewing') : t('transfer.import')}
          </button>
          <input ref={picker} type="file" accept=".zip,application/zip" hidden onChange={inspect} />
        </>
      )}
    >
      {note === undefined ? null : <p className={note.ok ? 'vac-hint' : 'vac-error'} role="status">{note.text}</p>}
      {exporting ? (
        <ExportDialog t={t} close={() => { setExporting(false) }}
          done={(name) => { setExporting(false); setNote({ ok: true, text: fill(t('transfer.exported'), { name }) }) }} />
      ) : null}
      {openImport === undefined ? null : (
        <ImportDialog key={openImport.preview.sha256} t={t} open={openImport} close={() => { setOpenImport(undefined) }} onImported={onImported} />
      )}
    </Section>
  )
}

function ExportDialog({ t, close, done }: { t: Translate; close: () => void; done: (name: string) => void }) {
  const [user, setUser] = useState(true)
  const [space, setSpace] = useState(true)
  const [projectIds, setProjectIds] = useState<readonly string[]>([])
  const [projects, setProjects] = useState<readonly MemoryProject[] | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  useEffect(() => {
    let current = true
    loadOverview({}).then((overview) => { if (current) setProjects(overview.projects) }, (failure: unknown) => { if (current) setError(messageOf(failure)) })
    return () => { current = false }
  }, [])
  const empty = !user && !space && projectIds.length === 0
  const run = () => {
    setBusy(true)
    setError(undefined)
    callHost<ExportedPackage>('POST', 'export', { user, space, memoryProjectIds: projectIds }).then((exported) => {
      download(exported.fileName, fromBase64(exported.archive))
      done(exported.fileName)
    }, (failure: unknown) => { setError(messageOf(failure)) }).finally(() => { setBusy(false) })
  }
  return (
    <Dialog
      title={t('transfer.exportTitle')}
      lead={t('transfer.exportHint')}
      busy={busy}
      close={close}
      footer={(
        <>
          <button type="button" className="vac-btn" disabled={busy} onClick={close}>{t('cancel')}</button>
          <button type="button" className="vac-btn primary" disabled={busy || empty} onClick={run}>{t('transfer.download')}</button>
        </>
      )}
    >
      <label className="vmm-check"><input type="checkbox" checked={user} onChange={(event) => { setUser(event.target.checked) }} />{t('nav.user')}</label>
      <label className="vmm-check"><input type="checkbox" checked={space} onChange={(event) => { setSpace(event.target.checked) }} />{t('nav.space')}</label>
      {projects === undefined ? (error === undefined ? <p className="vac-hint">{t('loading')}</p> : null) : projects.map(project => (
        <label key={project.id} className="vmm-check">
          <input
            type="checkbox"
            checked={projectIds.includes(project.id)}
            onChange={(event) => { setProjectIds(event.target.checked ? [...projectIds, project.id] : projectIds.filter(id => id !== project.id)) }}
          />
          <span>
            {fill(t('transfer.projectScope'), { name: project.name })}
            {project.paths[0] === undefined ? null : <span className="vmm-mono"> {project.paths[0]}</span>}
          </span>
        </label>
      ))}
      {error === undefined ? null : <p className="vac-error" role="alert">{error}</p>}
    </Dialog>
  )
}

function ImportDialog({ t, open, close, onImported }: { t: Translate; open: OpenImport; close: () => void; onImported: () => void }) {
  const { archive, name, preview: initial, localProjects } = open
  const hasProjects = initial.projects.length > 0
  // Each packaged project's choice: `link:<id>`, `create`, `ignore`, or '' while unset. Candidates
  // are only listed first as hints; nothing is preselected.
  const [targets, setTargets] = useState<Record<string, string>>(() => Object.fromEntries(initial.projects.map(entry => [entry.project.id, ''])))
  const [review, setReview] = useState<ImportPreview | undefined>(hasProjects ? undefined : initial)
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>(() => (hasProjects ? {} : defaultChoices(initial)))
  const [report, setReport] = useState<ImportReport | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const mappings = (): ProjectMapping[] => initial.projects.map(({ project }) => {
    const value = targets[project.id] ?? ''
    return {
      packageProjectId: project.id,
      target: value.startsWith('link:') ? { action: 'link', memoryProjectId: value.slice('link:'.length) }
        : value === 'create' ? { action: 'create' } : { action: 'ignore' },
    }
  })
  const run = (task: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    task().catch((failure: unknown) => { setError(messageOf(failure)) }).finally(() => { setBusy(false) })
  }
  const toReview = () => { run(async () => {
    const next = await callHost<ImportPreview>('POST', 'import/preview', { archive, name, projects: mappings() })
    setChoices(defaultChoices(next))
    setReview(next)
  }) }
  const apply = () => { run(async () => {
    if (review === undefined) return
    const resolutions = review.scopes.flatMap(scope => scope.conflicts.map(conflict => ({
      scope: scope.scope,
      ...scope.packageProjectId === null ? {} : { packageProjectId: scope.packageProjectId },
      nodeId: conflict.id,
      choice: choices[conflictKey(scope, conflict)] ?? 'keep_local',
    })))
    setReport(await callHost<ImportReport>('POST', 'import', { archive, name, expectedSha256: review.sha256, projects: mappings(), resolutions }))
    onImported()
  }) }
  const fillUnset = (value: string) => { setTargets(Object.fromEntries(Object.entries(targets).map(([id, current]) => [id, current || value]))) }
  const unset = Object.values(targets).some(value => value === '')
  const projectName = (packageProjectId: string | null) =>
    initial.projects.find(entry => entry.project.id === packageProjectId)?.project.name ?? packageProjectId ?? ''

  let body
  let footer
  if (report !== undefined) {
    body = (
      <>
        <p>{fill(t('transfer.report'), { added: report.added, replaced: report.replaced, unchanged: report.unchanged })}</p>
        {report.createdProjects.length === 0 ? null : <p>{fill(t('transfer.reportCreated'), { count: report.createdProjects.length })}</p>}
        {report.backupDirectory === null ? null : <p>{t('transfer.reportBackup')}<code className="vmm-mono">{report.backupDirectory}</code></p>}
      </>
    )
    footer = <button type="button" className="vac-btn primary" onClick={close}>{t('transfer.done')}</button>
  } else if (review === undefined) {
    body = (
      <>
        <p className="vac-hint">{t('transfer.projectsHint')}</p>
        {initial.projects.map(({ project, candidates }) => {
          const candidateIds = new Set(candidates.map(candidate => candidate.memoryProjectId))
          return (
            <div key={project.id} className="vmm-import-project">
              <div>
                <strong>{project.name}</strong>
                {project.paths[0] === undefined ? null : <span className="vmm-mono">{project.paths[0]}</span>}
              </div>
              <select
                className="vmm-select"
                aria-label={fill(t('transfer.targetFor'), { name: project.name })}
                disabled={busy}
                value={targets[project.id] ?? ''}
                onChange={(event) => { setTargets({ ...targets, [project.id]: event.target.value }) }}
              >
                <option value="" disabled>{t('transfer.targetUnset')}</option>
                {candidates.map(candidate => (
                  <option key={candidate.memoryProjectId} value={`link:${candidate.memoryProjectId}`}>
                    {fill(t('transfer.linkCandidate'), { name: candidate.name, reasons: candidate.reasons.map(reason => reasonLabel(t, reason)).join(', ') })}
                  </option>
                ))}
                {localProjects.filter(local => !candidateIds.has(local.id)).map(local => (
                  <option key={local.id} value={`link:${local.id}`}>{fill(t('transfer.link'), { name: local.name })}</option>
                ))}
                <option value="create">{t('transfer.create')}</option>
                <option value="ignore">{t('transfer.ignore')}</option>
              </select>
            </div>
          )
        })}
        {unset ? (
          <span className="vac-inline">
            <button type="button" className="vac-btn sm" disabled={busy} onClick={() => { fillUnset('create') }}>{t('transfer.createRest')}</button>
            <button type="button" className="vac-btn sm" disabled={busy} onClick={() => { fillUnset('ignore') }}>{t('transfer.ignoreRest')}</button>
          </span>
        ) : null}
      </>
    )
    footer = (
      <>
        <button type="button" className="vac-btn" disabled={busy} onClick={close}>{t('cancel')}</button>
        <button type="button" className="vac-btn primary" disabled={busy || unset} onClick={toReview}>{t('transfer.next')}</button>
      </>
    )
  } else {
    body = (
      <>
        {review.scopes.length === 0 ? <p className="vac-hint">{t('transfer.nothing')}</p> : null}
        {review.scopes.map(scope => (
          <div key={`${scope.scope}:${scope.packageProjectId ?? ''}`} className="vmm-import-scope">
            <h4>{scope.scope === 'project' ? fill(t('transfer.projectScope'), { name: projectName(scope.packageProjectId) }) : t(`nav.${scope.scope}` as Key)}</h4>
            <p className="vac-hint">{fill(t('transfer.counts'), { same: scope.same, added: scope.added.length, conflicts: scope.conflicts.length })}</p>
            {scope.newSections.length === 0 ? null : <p className="vac-hint">{fill(t('transfer.newSections'), { titles: scope.newSections.join(', ') })}</p>}
            {scope.duplicates.length === 0 ? null : (
              <p className="vac-hint">{fill(t('transfer.duplicates'), { titles: scope.duplicates.map(node => node.path.join(' › ')).join(', ') })}</p>
            )}
            {scope.conflicts.map((conflict) => {
              const key = conflictKey(scope, conflict)
              return (
                <div key={key} className="vmm-conflict">
                  <span className="vac-inline">
                    <strong>{conflict.path.join(' › ')}</strong>
                    {conflict.newer === 'unknown' ? null : (
                      <span className="vac-badge info">{t(conflict.newer === 'imported' ? 'transfer.newerImported' : 'transfer.newerLocal')}</span>
                    )}
                  </span>
                  <Segments value={choices[key] ?? 'keep_local'} label={conflict.path.join(' › ')} disabled={busy}
                    onChange={(value) => { setChoices({ ...choices, [key]: value }) }}
                    options={CHOICES.map(value => ({ value, label: t(`transfer.choice.${value}` as Key) }))} />
                  <details>
                    <summary className="vac-hint">{t('transfer.compare')}</summary>
                    <div className="vmm-conflict-sides">
                      <ConflictSide t={t} label={t('transfer.local')} side={conflict.local} />
                      <ConflictSide t={t} label={t('transfer.imported')} side={conflict.imported} />
                    </div>
                  </details>
                </div>
              )
            })}
          </div>
        ))}
      </>
    )
    footer = (
      <>
        <button type="button" className="vac-btn" disabled={busy} onClick={hasProjects ? () => { setReview(undefined) } : close}>
          {hasProjects ? t('transfer.back') : t('cancel')}
        </button>
        <button type="button" className="vac-btn primary" disabled={busy || review.scopes.length === 0} onClick={apply}>{t('transfer.apply')}</button>
      </>
    )
  }

  return (
    <Dialog title={t('transfer.importTitle')} lead={fill(t('transfer.importHint'), { time: initial.exportedAt })} wide busy={busy} close={close} footer={footer}>
      <code className="vmm-mono">{name}</code>
      {body}
      {error === undefined ? null : <p className="vac-error" role="alert">{error}</p>}
    </Dialog>
  )
}

function ConflictSide({ t, label, side }: { t: Translate; label: string; side: NodeSide }) {
  return (
    <div className="vmm-conflict-side">
      <span>{label}{side.updated === null ? '' : ` · ${fill(t('node.updated'), { time: side.updated })}`}</span>
      <strong>{side.title}</strong>
      <pre>{side.body}</pre>
    </div>
  )
}

function conflictKey(scope: ScopeMergePreview, conflict: NodeConflict): string {
  return `${scope.scope}:${scope.packageProjectId ?? ''}:${conflict.id}`
}

/** Every conflict starts at its newer side, keeping the local note when unknown. */
function defaultChoices(preview: ImportPreview): Record<string, ConflictChoice> {
  return Object.fromEntries(preview.scopes.flatMap(scope => scope.conflicts.map(conflict => [
    conflictKey(scope, conflict),
    conflict.newer === 'imported' ? 'take_imported' : 'keep_local',
  ])))
}
