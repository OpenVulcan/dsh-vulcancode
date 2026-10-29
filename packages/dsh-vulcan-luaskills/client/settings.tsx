/**
 * Settings › LuaSkills: the runtime section, then the VM and runtime settings. The settings are
 * shown before the runtime is installed but stay locked until it is.
 */

import { useEffect, useState } from 'react'

import { fill, type Key, type Translate } from './i18n'
import { RuntimeSection, useRuntime } from './runtime'
import {
  callHost, isInstalled, messageOf, TEXT_ENCODINGS, type HostWatch, type LuaSkillsSettings, type RuntimeView,
} from './shared'

export function SettingsPage({ view, t }: { view: HostWatch<RuntimeView | null>; t: Translate }) {
  const live = useRuntime(view)
  return (
    <div className="vac vac-page">
      <div className="vac-page-head">
        <h2>{t('settingsPage.title')}</h2>
        <p className="vac-lead">{t('settingsPage.lead')}</p>
      </div>
      {live === undefined ? <p className="vac-hint">{t('loading')}</p>
        : live === null ? <div className="vac-alert bad">{t('unavailable')}</div>
          : (
            <>
              <RuntimeSection view={view} live={live} t={t} />
              <SettingsSection view={view} live={live} t={t} />
            </>
          )}
    </div>
  )
}

/** Every number setting: its path in the settings value and its label. */
type NumberPath = readonly [keyof LuaSkillsSettings, string]
const POOL_FIELDS = [['minSize', 'settings.minSize'], ['maxSize', 'settings.maxSize'], ['idleTtlSecs', 'settings.idleTtl']] as const
const CACHE_FIELDS = [['maxEntries', 'settings.maxEntries'], ['defaultTtlSecs', 'settings.defaultTtl'], ['maxTtlSecs', 'settings.maxTtl']] as const
const MANAGED_FIELDS = [
  ['workerPoolMaxSizePerEnvironment', 'settings.managedWorkerPoolMax'],
  ['workerIdleTtlSecs', 'settings.managedWorkerIdleTtl'],
  ['persistentSessionLimitPerEngine', 'settings.managedSessionLimit'],
  ['persistentSessionDefaultBufferLimitBytesPerStream', 'settings.managedSessionBuffer'],
  ['invokeDefaultTimeoutMs', 'settings.managedInvokeTimeout'],
] as const
const NUMBER_PATHS: readonly NumberPath[] = [
  ...POOL_FIELDS.map(([field]) => ['vmPool', field] as const),
  ...POOL_FIELDS.map(([field]) => ['runLuaPool', field] as const),
  ...CACHE_FIELDS.map(([field]) => ['toolCache', field] as const),
  ...MANAGED_FIELDS.map(([field]) => ['managedRuntime', field] as const),
]

/** The form keeps numbers as typed text until they are checked. */
type Draft = { readonly settings: LuaSkillsSettings; readonly numbers: Readonly<Record<string, string>> }

function draftOf(settings: LuaSkillsSettings): Draft {
  const numbers: Record<string, string> = {}
  for (const [group, field] of NUMBER_PATHS) numbers[`${group}.${field}`] = String((settings[group] as unknown as Record<string, number>)[field])
  return { settings, numbers }
}

/** The settings value a draft stands for, or the key of what is wrong with it. */
function settle(draft: Draft): LuaSkillsSettings | Key {
  const value = structuredClone(draft.settings) as unknown as Record<string, Record<string, unknown>>
  for (const [group, field] of NUMBER_PATHS) {
    const text = draft.numbers[`${group}.${field}`]?.trim() ?? ''
    if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) return 'settings.validationPositive'
    value[group]![field] = Number(text)
  }
  const settings = value as unknown as LuaSkillsSettings
  if (settings.vmPool.maxSize < settings.vmPool.minSize || settings.runLuaPool.maxSize < settings.runLuaPool.minSize) return 'settings.validationPoolOrder'
  if (settings.toolCache.maxTtlSecs < settings.toolCache.defaultTtlSecs) return 'settings.validationCacheOrder'
  const urls = [settings.network.githubBaseUrl, settings.network.githubApiBaseUrl, settings.network.officialSkillHubBaseUrl]
  if (!urls.every(url => url === null || /^https?:\/\/[^\s/]+/i.test(url))) return 'settings.validationUrl'
  return settings
}

function SettingsSection({ view, live, t }: { view: HostWatch<RuntimeView | null>; live: RuntimeView; t: Translate }) {
  const saved = live.settings
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ readonly ok: boolean; readonly text: string } | undefined>(undefined)
  // Follow the saved settings until the user starts editing.
  const savedText = JSON.stringify(saved)
  useEffect(() => {
    if (!dirty) setDraft(draftOf(saved))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `savedText` stands for `saved`.
  }, [savedText, dirty])

  const locked = !isInstalled(live.state) || live.state.kind === 'starting' || busy
  const settled = settle(draft)
  const edit = (change: (draft: Draft) => Draft) => {
    setDraft(change)
    setDirty(true)
    setNote(undefined)
  }
  const setNumber = (key: string, text: string) => { edit(current => ({ ...current, numbers: { ...current.numbers, [key]: text } })) }
  const setField = <G extends keyof LuaSkillsSettings>(group: G, field: keyof LuaSkillsSettings[G], value: unknown) => {
    edit(current => ({ ...current, settings: { ...current.settings, [group]: { ...current.settings[group], [field]: value } } }))
  }
  const save = () => {
    if (typeof settled === 'string') return
    setBusy(true)
    setNote(undefined)
    callHost('POST', 'settings', settled).then(() => {
      setDirty(false)
      setNote({ ok: true, text: t('settings.saved') })
    }, (failure: unknown) => {
      setNote({ ok: false, text: messageOf(failure) })
    }).finally(() => {
      setBusy(false)
      view.refresh()
    })
  }

  const numberField = (group: keyof LuaSkillsSettings, field: string, label: string) => {
    const key = `${group}.${field}`
    return (
      <label key={key} className="vls-field">
        <span>{t(label as Key)}</span>
        <input
          className="vls-input vac-mono"
          inputMode="numeric"
          disabled={locked}
          value={draft.numbers[key] ?? ''}
          onChange={(event) => { setNumber(key, event.target.value) }}
        />
      </label>
    )
  }
  const toggle = <G extends keyof LuaSkillsSettings>(group: G, field: keyof LuaSkillsSettings[G], label: Key) => (
    <label className="vls-check">
      <input
        type="checkbox"
        disabled={locked}
        checked={draft.settings[group][field] as boolean}
        onChange={(event) => { setField(group, field, event.target.checked) }}
      />
      <span>{t(label)}</span>
    </label>
  )
  const urlField = (field: 'githubBaseUrl' | 'githubApiBaseUrl', label: Key, fallback: string) => (
    <label className="vls-field wide">
      <span>{t(label)}</span>
      <input
        className="vls-input vac-mono"
        disabled={locked}
        placeholder={fill(t('settings.defaultPlaceholder'), { url: fallback })}
        value={draft.settings.network[field] ?? ''}
        onChange={(event) => { setField('network', field, event.target.value.trim() === '' ? null : event.target.value.trim()) }}
      />
    </label>
  )

  return (
    <section className="vac-section">
      <div className="vac-section-head">
        <div>
          <h3 className="vac-section-title">{t('settings.title')}</h3>
          <p className="vac-section-lead">{isInstalled(live.state) ? t('settings.lead') : t('settings.locked')}</p>
        </div>
      </div>
      <div className="vac-section-body">
        {live.settingsError === undefined ? null : <div className="vac-alert warn">{fill(t('settings.invalid'), { error: live.settingsError })}</div>}
        <fieldset className="vls-group" disabled={locked}>
          <legend>{t('settings.mainPool')}</legend>
          <p className="vac-hint">{t('settings.poolHint')}</p>
          <div className="vls-grid">{POOL_FIELDS.map(([field, label]) => numberField('vmPool', field, label))}</div>
        </fieldset>
        <fieldset className="vls-group" disabled={locked}>
          <legend>{t('settings.runLuaPool')}</legend>
          <div className="vls-grid">{POOL_FIELDS.map(([field, label]) => numberField('runLuaPool', field, label))}</div>
        </fieldset>
        <fieldset className="vls-group" disabled={locked}>
          <legend>{t('settings.toolCache')}</legend>
          <div className="vls-grid">{CACHE_FIELDS.map(([field, label]) => numberField('toolCache', field, label))}</div>
        </fieldset>
        <fieldset className="vls-group" disabled={locked}>
          <legend>{t('settings.managedRuntime')}</legend>
          <p className="vac-hint">{t('settings.managedRuntimeHint')}</p>
          <div className="vls-grid">{MANAGED_FIELDS.map(([field, label]) => numberField('managedRuntime', field, label))}</div>
        </fieldset>
        <fieldset className="vls-group" disabled={locked}>
          <legend>{t('settings.capabilities')}</legend>
          <label className="vls-field">
            <span>{t('settings.defaultEncoding')}</span>
            <select
              className="vls-input"
              disabled={locked}
              value={draft.settings.capabilities.defaultTextEncoding ?? ''}
              onChange={(event) => { setField('capabilities', 'defaultTextEncoding', event.target.value === '' ? null : event.target.value) }}
            >
              <option value="">{t('settings.autoEncoding')}</option>
              {TEXT_ENCODINGS.map(encoding => <option key={encoding} value={encoding}>{encoding}</option>)}
            </select>
          </label>
          {toggle('capabilities', 'enableSkillManagementBridge', 'settings.skillManagementBridge')}
          {toggle('capabilities', 'enableManagedIoCompat', 'settings.managedIoCompat')}
        </fieldset>
        <fieldset className="vls-group" disabled={locked}>
          <legend>{t('settings.network')}</legend>
          {toggle('network', 'allowDownloads', 'settings.allowDownloads')}
          {urlField('githubBaseUrl', 'settings.githubBaseUrl', 'https://github.com')}
          {urlField('githubApiBaseUrl', 'settings.githubApiBaseUrl', 'https://api.github.com')}
          <label className="vls-field wide">
            <span>{t('settings.skillHubBaseUrl')}</span>
            <input
              className="vls-input vac-mono"
              disabled={locked}
              value={draft.settings.network.officialSkillHubBaseUrl}
              onChange={(event) => { setField('network', 'officialSkillHubBaseUrl', event.target.value.trim()) }}
            />
            <span className="vac-inline">
              {live.hubSites.map(site => (
                <button
                  key={site.site}
                  type="button"
                  className="vac-link"
                  disabled={locked}
                  onClick={() => { setField('network', 'officialSkillHubBaseUrl', site.url) }}
                >
                  {t(`hub.site.${site.site}` as Key)}
                </button>
              ))}
            </span>
          </label>
        </fieldset>
        <div className="vac-between">
          <span>
            {typeof settled === 'string' && dirty ? <span className="vac-error">{t(settled)}</span> : null}
            {note === undefined ? null : <span className={note.ok ? 'vac-hint' : 'vac-error'} role={note.ok ? undefined : 'alert'}>{note.text}</span>}
          </span>
          <span className="vac-inline">
            <button type="button" className="vac-btn" disabled={locked || !dirty} onClick={() => { setDirty(false); setDraft(draftOf(saved)); setNote(undefined) }}>
              {t('settings.revert')}
            </button>
            <button type="button" className="vac-btn primary" disabled={locked || !dirty || typeof settled === 'string'} onClick={save}>
              {busy ? t('settings.saving') : t('settings.save')}
            </button>
          </span>
        </div>
      </div>
    </section>
  )
}
