/**
 * The memory mode tab (`memory-mode-page.tsx`): the mode and the Markdown injection budget, the
 * memory projects with their switch, and import/export.
 */

import { useCallback, useEffect, useState } from 'react'

import { fill, type Key, type Translate } from './i18n'
import { Section, Segments } from './parts'
import {
  BUDGET_PARTS, callHost, loadOverview, messageOf, type BudgetPart, type InjectionBudget, type MemoryMode, type MemoryProject,
  type MemorySettingsView,
} from './shared'
import { TransferSection } from './transfer'

const MODES: readonly MemoryMode[] = ['off', 'vmm', 'markdown']

export function ModeTab({ t, onSettings }: { t: Translate; onSettings: (settings: MemorySettingsView) => void }) {
  const [settings, setSettings] = useState<MemorySettingsView | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const [mode, setMode] = useState<MemoryMode>('markdown')
  const [budget, setBudget] = useState<Record<BudgetPart, string>>(() => draft({ user: 0, spaceBase: 0, projectBase: 0, spaceCatalog: 0, projectCatalog: 0 }))
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | undefined>(undefined)
  const [generation, setGeneration] = useState(0)

  const adopt = useCallback((next: MemorySettingsView) => {
    setSettings(next)
    setMode(next.mode)
    setBudget(draft(next.budget))
    onSettings(next)
  }, [onSettings])
  const load = useCallback(() => {
    setLoadError(undefined)
    callHost<MemorySettingsView>('GET', 'settings').then(adopt, (failure: unknown) => { setLoadError(messageOf(failure)) })
  }, [adopt])
  useEffect(() => { load() }, [load])

  if (settings === undefined) {
    return loadError === undefined ? <p className="vac-hint">{t('loading')}</p> : (
      <div className="vac-alert bad vac-between">
        <span>{t('loadFailed')}: {loadError}</span>
        <button type="button" className="vac-btn sm" onClick={load}>{t('retry')}</button>
      </div>
    )
  }
  const parsed = parseBudget(budget, settings.maxPartTokens)
  const changed = mode !== settings.mode || (parsed !== null && BUDGET_PARTS.some(part => parsed[part] !== settings.budget[part]))
  const total = parsed === null ? null : BUDGET_PARTS.reduce((sum, part) => sum + parsed[part], 0)
  const save = () => {
    if (parsed === null) return
    setSaving(true)
    setNote(undefined)
    callHost<MemorySettingsView>('POST', 'settings', { mode, budget: parsed }).then((next) => {
      adopt(next)
      setNote({ ok: true, text: t('saved') })
    }, (failure: unknown) => { setNote({ ok: false, text: `${t('saveFailed')}: ${messageOf(failure)}` }) }).finally(() => { setSaving(false) })
  }

  return (
    <>
      <Section
        title={t('mode.title')}
        lead={t('mode.hint')}
        actions={<button type="button" className="vac-btn sm primary" disabled={saving || !changed || parsed === null} onClick={save}>{t('save')}</button>}
      >
        <Segments value={mode} label={t('mode.title')} disabled={saving} onChange={setMode}
          options={MODES.map(value => ({ value, label: t(`mode.${value}` as Key) }))} />
        <p className="vac-hint">{t(`mode.${mode}Hint` as Key)}</p>
        {mode !== 'markdown' ? null : (
          <>
            <div className="vmm-grid">
              {BUDGET_PARTS.map(part => (
                <label key={part} className="vmm-field">
                  {t(`part.${part}` as Key)}
                  <input
                    className="vmm-input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={settings.maxPartTokens}
                    step={50}
                    disabled={saving}
                    value={budget[part]}
                    aria-invalid={validPart(budget[part], settings.maxPartTokens) ? undefined : true}
                    onChange={(event) => { setBudget({ ...budget, [part]: event.target.value }) }}
                  />
                </label>
              ))}
            </div>
            <div className="vac-between">
              <span className="vac-hint">
                {t('budget.hint')} {total === null ? fill(t('budget.invalid'), { max: settings.maxPartTokens }) : fill(t('budget.total'), { tokens: total })}
              </span>
              <button type="button" className="vac-btn sm" disabled={saving} onClick={() => { setBudget(draft(settings.defaultBudget)) }}>{t('budget.reset')}</button>
            </div>
          </>
        )}
        {note === undefined ? null : <p className={note.ok ? 'vac-hint' : 'vac-error'} role="status">{note.text}</p>}
      </Section>
      {settings.mode !== 'markdown' ? null : (
        <>
          <ProjectsSection key={generation} t={t} />
          <TransferSection t={t} onImported={() => { setGeneration(value => value + 1) }} />
        </>
      )}
    </>
  )
}

function ProjectsSection({ t }: { t: Translate }) {
  const [projects, setProjects] = useState<readonly MemoryProject[] | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState<string | undefined>(undefined)
  useEffect(() => {
    let current = true
    loadOverview({}).then((overview) => { if (current) setProjects(overview.projects) }, (failure: unknown) => { if (current) setError(messageOf(failure)) })
    return () => { current = false }
  }, [])
  const toggle = (project: MemoryProject, enabled: boolean) => {
    setBusy(project.id)
    setError(undefined)
    callHost<MemoryProject[]>('POST', 'project', { action: 'set_enabled', memoryProjectId: project.id, enabled })
      .then(setProjects, (failure: unknown) => { setError(`${t('saveFailed')}: ${messageOf(failure)}`) })
      .finally(() => { setBusy(undefined) })
  }
  return (
    <Section title={t('projects.title')} lead={t('projects.hint')} flush>
      {error === undefined ? null : <p className="vac-error vmm-pad">{error}</p>}
      {projects === undefined ? (error === undefined ? <p className="vac-hint vmm-pad">{t('loading')}</p> : null)
        : projects.length === 0 ? <p className="vac-hint vmm-pad">{t('projects.empty')}</p> : (
          <ul className="vmm-list">
            {projects.map(project => (
              <li key={project.id} className="vmm-row">
                <div className="vmm-row-main">
                  <span className="vac-inline">
                    <strong>{project.name}</strong>
                    {project.orphaned ? <span className="vac-badge warn">{t('projects.orphaned')}</span> : null}
                  </span>
                  {project.paths.length === 0 ? null : <span className="vmm-mono">{project.paths.join(' · ')}</span>}
                </div>
                <label className="vmm-check">
                  <input type="checkbox" checked={project.memoryEnabled} disabled={busy !== undefined}
                    onChange={(event) => { toggle(project, event.target.checked) }} />
                  {t('projects.enabled')}
                </label>
              </li>
            ))}
          </ul>
        )}
    </Section>
  )
}

function draft(budget: InjectionBudget): Record<BudgetPart, string> {
  return Object.fromEntries(BUDGET_PARTS.map(part => [part, String(budget[part])])) as Record<BudgetPart, string>
}

function validPart(text: string, max: number): boolean {
  const value = Number(text)
  return text.trim() !== '' && Number.isInteger(value) && value >= 0 && value <= max
}

function parseBudget(values: Record<BudgetPart, string>, max: number): InjectionBudget | null {
  if (!BUDGET_PARTS.every(part => validPart(values[part], max))) return null
  return Object.fromEntries(BUDGET_PARTS.map(part => [part, Number(values[part])])) as unknown as InjectionBudget
}
