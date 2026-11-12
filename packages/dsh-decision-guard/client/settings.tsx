/**
 * Settings › Auto approval: the whole configuration of the plugin as numbered Vulcan sections.
 * Every control saves on its own as soon as it changes; only the review rules and the additional
 * prompts, being free text, are saved together with a button. The decision log opens in place of
 * the page.
 */

import { useEffect, useId, useRef, useState } from 'react'

import { fill, type Key, type Translate } from './i18n'
import { AccountSection, EndpointsSection, lockEndpoint, ModelSection } from './cloud'
import { LocalSections } from './local'
import { RecordsPanel } from './records'
import {
  callPanel, DEFAULT_ASK_TIMEOUT, MAX_ASK_TIMEOUT, MAX_PROMPT_CHARS, running, type GuardSettings, type ModelList, type PanelState, type Services,
} from './shared'
import { Badge, Choices, ErrorLine, Section, Segments, useAction, usePolling, useSettings, useWatch, type Tone } from './ui'

/** Sample calls for trying the backend. */
const TRY_CALLS = {
  safe: { tool: 'shell_command', args: { command: 'git status', shell: 'bash' } },
  risky: { tool: 'shell_command', args: { command: 'git push --force origin main', shell: 'bash' } },
} as const

// The sections appear in the same order in navigation and in the page.
// 分区在导航和正文中按同一顺序排列。
const SETTINGS_VIEWS = ['engine', 'policy', 'records'] as const

// The identifier of one auto-approval settings section.
// 自动审批设置中的单个分区标识。
type SettingsView = typeof SETTINGS_VIEWS[number]

type Save = ReturnType<typeof useSettings>['save']

/**
 * Describe the configured backend using the latest account and model-list response.
 * 使用最新账号和模型目录响应描述已配置的判定后端。
 */
export function decisionStatus(t: Translate, value: GuardSettings, live: PanelState | null | undefined, list: ModelList | undefined): { tone: Tone; text: string } {
  if (live == null) return { tone: 'outline', text: t('loading') }
  if (value.backend === 'cloud') {
    if (!live.account.signedIn) return { tone: 'warn', text: t('status.decision.signedOut') }
    if (list === undefined) return { tone: 'outline', text: t('model.loading') }
    if (list.kind === 'failed') return { tone: 'warn', text: t('status.decision.cloudLoadFailed') }
    const model = value.cloudModel === '' ? list.models[0] : value.cloudModel
    if (list.models.length === 0 || model === undefined) return { tone: 'warn', text: t('status.decision.cloudNoModel') }
    if (!list.models.includes(model)) return { tone: 'warn', text: fill(t('model.disabled'), { model }) }
    return { tone: 'ok', text: fill(t('status.decision.cloud'), { model }) }
  }
  const pack = live.packs.find(item => item.id === value.localPack && item.installed !== null)
  const model = live.models.find(item => item.id === value.localModel)
  if (pack === undefined || model === undefined) return { tone: 'warn', text: t('status.decision.localMissing') }
  return { tone: 'ok', text: fill(t('status.decision.local'), { pack: pack.id, model: model.name }) }
}

function StatusSection({ services, t, value, live }: { services: Services; t: Translate; value: GuardSettings; live: PanelState | null | undefined }) {
  const heldByReview = useWatch(services.autoReview)
  const listed = useWatch(services.autoListed)
  const models = useWatch(services.cloudModels)
  const decision = decisionStatus(t, value, live, models)
  let auto: { tone: Tone; text: Key; badge: Key }
  if (value.mode === 'standalone') auto = { tone: 'outline', text: 'status.auto.standalone', badge: 'tone.off' }
  else if (heldByReview === true) auto = { tone: 'warn', text: 'status.auto.held', badge: 'tone.warn' }
  else if (listed === true) auto = { tone: 'ok', text: 'status.auto.provided', badge: 'tone.ok' }
  else auto = { tone: 'outline', text: 'status.auto.pending', badge: 'status.auto.pending' }
  return (
    <Section title={t('status.title')} flush>
      <div className="vdg-rows">
        <div className="vdg-row">
          <span className="vdg-row-label">{t('status.decision')}</span>
          <span className="vdg-row-value">
            {decision.text}
            {decision.tone === 'outline' ? null : <Badge tone={decision.tone}>{t(decision.tone === 'ok' ? 'tone.ok' : 'tone.warn')}</Badge>}
          </span>
        </div>
        <div className="vdg-row">
          <span className="vdg-row-label">{t('status.auto')}</span>
          <span className="vdg-row-value">
            {t(auto.text)}
            <Badge tone={auto.tone}>{t(auto.badge)}</Badge>
          </span>
        </div>
      </div>
    </Section>
  )
}

function OptionsSection({ t, value, disabled, save }: { t: Translate; value: GuardSettings; disabled: boolean; save: Save }) {
  const row = <F extends 'crossProjectWrites' | 'databaseReset' | 'projectReset', V extends string>(
    field: F, prefix: 'cross' | 'database' | 'project', values: readonly V[],
  ) => (
    <div className="vdg-row">
      <span>{t(`${prefix}.title` as Key)}</span>
      <Segments
        label={t(`${prefix}.title` as Key)}
        value={value[field] as V}
        options={values.map(item => ({ value: item, title: t(`${prefix}.${item}` as Key) }))}
        disabled={disabled}
        onChoose={(next) => { save({ [field]: next }) }}
      />
    </div>
  )
  return (
    <Section title={t('options.title')} lead={t('options.lead')} flush>
      <div className="vdg-rows">
        {row('crossProjectWrites', 'cross', ['allow', 'review'] as const)}
        {row('databaseReset', 'database', ['confirm', 'allow'] as const)}
        {row('projectReset', 'project', ['confirm', 'allow'] as const)}
      </div>
    </Section>
  )
}

/** Provider and model pickers for a chosen review model, from the Host's model catalog. */
function ReviewModelPicker({ services, t, value, disabled, save }: { services: Services; t: Translate; value: GuardSettings; disabled: boolean; save: Save }) {
  const catalog = useWatch(services.modelCatalog)
  usePolling(services.modelCatalog, undefined)
  if (catalog === undefined) return <p className="vdg-hint">{t('review.catalogFailed')}</p>
  const provider = value.reviewProvider ?? ''
  const model = value.reviewModel ?? ''
  const group = catalog.groups.find(item => item.id === provider)
  // A saved choice the catalog no longer lists stays visible instead of silently changing.
  const providers = group === undefined && provider !== '' ? [{ id: provider, name: provider, models: [] }, ...catalog.groups] : catalog.groups
  const models = group?.models ?? []
  const modelList = model === '' || models.some(item => item.id === model) ? models : [{ id: model, name: model }, ...models]
  return (
    <>
      <div className="vdg-inline" style={{ alignItems: 'flex-start' }}>
        <div className="vdg-field">
          <span className="vdg-label">{t('review.provider')}</span>
          <select
            className="vdg-select"
            aria-label={t('review.provider')}
            value={provider}
            disabled={disabled}
            onChange={(event) => { save({ reviewProvider: event.target.value === '' ? undefined : event.target.value, reviewModel: undefined }) }}
          >
            <option value="">{t('review.pick')}</option>
            {providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div className="vdg-field">
          <span className="vdg-label">{t('review.model')}</span>
          <select
            className="vdg-select"
            aria-label={t('review.model')}
            value={model}
            disabled={disabled || provider === ''}
            onChange={(event) => { save({ reviewModel: event.target.value === '' ? undefined : event.target.value }) }}
          >
            <option value="">{t('review.pick')}</option>
            {modelList.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
      </div>
      {provider === '' || model === '' ? <div className="vdg-alert warn">{t('review.missing')}</div> : null}
    </>
  )
}

function ReviewSection({ services, t, value, disabled, save }: { services: Services; t: Translate; value: GuardSettings; disabled: boolean; save: Save }) {
  const reviews = ['session', 'custom', 'off'] as const
  return (
    <Section title={t('review.title')} lead={t('review.lead')}>
      <Choices
        label={t('review.title')}
        value={value.review}
        options={reviews.map(item => ({ value: item, title: t(`review.${item}` as Key), hint: t(`review.${item}.hint` as Key) }))}
        disabled={disabled}
        onChoose={(next) => { save({ review: next }) }}
      />
      {value.review === 'custom' ? <ReviewModelPicker services={services} t={t} value={value} disabled={disabled} save={save} /> : null}
      {value.review === 'off'
        ? null
        : (
          <label className="vdg-check">
            <input type="checkbox" checked={value.llmOverridesBlock} disabled={disabled} onChange={(event) => { save({ llmOverridesBlock: event.target.checked }) }} />
            <span>
              <span className="vdg-choice-title">{t('override.title')}</span>
              <span className="vdg-choice-hint">{t('override.hint')}</span>
            </span>
          </label>
        )}
    </Section>
  )
}

type RuleField = 'forbidRules' | 'denyRules' | 'allowRules'
const RULES: readonly { field: RuleField; key: 'forbid' | 'deny' | 'allow' }[] = [
  { field: 'forbidRules', key: 'forbid' },
  { field: 'denyRules', key: 'deny' },
  { field: 'allowRules', key: 'allow' },
]

function RulesSection({ t, value, disabled, saveAsync }: {
  t: Translate
  value: GuardSettings
  disabled: boolean
  saveAsync: ReturnType<typeof useSettings>['saveAsync']
}) {
  const [draft, setDraft] = useState<Partial<Record<RuleField, string>>>({})
  const dirty = RULES.some(rule => draft[rule.field] !== undefined && draft[rule.field] !== value[rule.field])
  return (
    <Section title={t('rules.title')} lead={t('rules.lead')}>
      {RULES.map(rule => (
        <div key={rule.field} className="vdg-field">
          <span className="vdg-label">{t(`rules.${rule.key}` as Key)}</span>
          <textarea
            className="vdg-textarea"
            aria-label={t(`rules.${rule.key}` as Key)}
            rows={3}
            value={draft[rule.field] ?? value[rule.field]}
            placeholder={t(`rules.${rule.key}.placeholder` as Key)}
            disabled={disabled}
            onChange={(event) => { setDraft(staged => ({ ...staged, [rule.field]: event.target.value })) }}
          />
        </div>
      ))}
      <div className="vdg-inline" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="vdg-btn" disabled={!dirty || disabled} onClick={() => { setDraft({}) }}>{t('rules.discard')}</button>
        <button
          type="button"
          className="vdg-btn primary"
          disabled={!dirty || disabled}
          onClick={() => { void saveAsync(draft).then((landed) => { if (landed) setDraft({}) }) }}
        >
          {t('rules.save')}
        </button>
      </div>
    </Section>
  )
}

type PromptField = 'reviewPrompt' | 'unattendedPolicy'
const PROMPTS: readonly { field: PromptField; key: 'review' | 'unattended'; placeholder: Key }[] = [
  { field: 'reviewPrompt', key: 'review', placeholder: 'reviewPrompt.placeholder' },
  { field: 'unattendedPolicy', key: 'unattended', placeholder: 'unattended.placeholder' },
]

/** The system defaults of the review prompt and the unattended deny policy. */
function PromptsSection({ t, value, disabled, saveAsync }: {
  t: Translate
  value: GuardSettings
  disabled: boolean
  saveAsync: ReturnType<typeof useSettings>['saveAsync']
}) {
  const [draft, setDraft] = useState<Partial<Record<PromptField, string>>>({})
  const text = (field: PromptField): string => draft[field] ?? value[field]
  const dirty = PROMPTS.some(prompt => draft[prompt.field] !== undefined && draft[prompt.field] !== value[prompt.field])
  const tooLong = PROMPTS.some(prompt => text(prompt.field).length > MAX_PROMPT_CHARS)
  return (
    <Section title={t('prompts.title')} lead={t('prompts.lead')}>
      {PROMPTS.map(prompt => (
        <div key={prompt.field} className="vdg-field">
          <span className="vdg-label">{t(`prompts.${prompt.key}`)}</span>
          <span className="vdg-hint">{t(`prompts.${prompt.key}.hint`)}</span>
          <textarea
            className="vdg-textarea"
            aria-label={t(`prompts.${prompt.key}`)}
            rows={3}
            value={text(prompt.field)}
            placeholder={t(prompt.placeholder)}
            disabled={disabled}
            onChange={(event) => { setDraft(staged => ({ ...staged, [prompt.field]: event.target.value })) }}
          />
          <span className="vdg-hint" style={{ alignSelf: 'flex-end', fontVariantNumeric: 'tabular-nums' }}>
            {fill(t('dialog.counter'), { count: text(prompt.field).length, max: MAX_PROMPT_CHARS })}
          </span>
        </div>
      ))}
      <div className="vdg-inline" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="vdg-btn" disabled={!dirty || disabled} onClick={() => { setDraft({}) }}>{t('rules.discard')}</button>
        <button
          type="button"
          className="vdg-btn primary"
          disabled={!dirty || disabled || tooLong}
          onClick={() => {
            const changes = Object.fromEntries(Object.entries(draft).map(([field, next]) => [field, next.trim()]))
            void saveAsync(changes).then((landed) => { if (landed) setDraft({}) })
          }}
        >
          {t('prompts.save')}
        </button>
      </div>
    </Section>
  )
}

/** The decision log switch and the way into the log. */
/**
 * Render the recording preference using the dictionary, current settings, disabled state and save callback.
 * 使用文案、当前设置、禁用状态与保存回调渲染判定记录开关。
 */
function RecordsSection({ t, value, disabled, save }: { t: Translate; value: GuardSettings; disabled: boolean; save: Save }) {
  return (
    <Section
      title={t('records.title')}
      lead={t('records.entryHint')}
    >
      <label className="vdg-check">
        <input type="checkbox" checked={value.recordDecisions} disabled={disabled} onChange={(event) => { save({ recordDecisions: event.target.checked }) }} />
        <span>
          <span className="vdg-choice-title">{t('records.enabled')}</span>
          <span className="vdg-choice-hint">{t('records.enabledHint')}</span>
        </span>
      </label>
    </Section>
  )
}

function AskSection({ t, value, disabled, save }: { t: Translate; value: GuardSettings; disabled: boolean; save: Save }) {
  const [text, setText] = useState(String(value.askTimeout))
  useEffect(() => { setText(String(value.askTimeout)) }, [value.askTimeout])
  const seconds = Number(text)
  const valid = Number.isInteger(seconds) && seconds >= 1 && seconds <= MAX_ASK_TIMEOUT
  const commit = (): void => {
    if (valid && seconds !== value.askTimeout) save({ askTimeout: seconds })
    else if (!valid) setText(String(value.askTimeout))
  }
  return (
    <Section title={t('ask.title')}>
      <label className="vdg-check">
        <input
          type="checkbox"
          checked={value.askTimeout > 0}
          disabled={disabled}
          onChange={(event) => { save({ askTimeout: event.target.checked ? DEFAULT_ASK_TIMEOUT : 0 }) }}
        />
        <span>
          <span className="vdg-choice-title">{t('ask.timeout')}</span>
          <span className="vdg-choice-hint">{t('ask.timeout.hint')}</span>
        </span>
      </label>
      {value.askTimeout > 0
        ? (
          <div className="vdg-inline" style={{ paddingLeft: 24 }}>
            <input
              className="vdg-input"
              type="number"
              min={1}
              max={MAX_ASK_TIMEOUT}
              step={1}
              style={{ width: 96 }}
              aria-label={t('ask.timeout')}
              aria-invalid={!valid}
              value={text}
              disabled={disabled}
              onChange={(event) => { setText(event.target.value) }}
              onBlur={commit}
              onKeyDown={(event) => { if (event.key === 'Enter') commit() }}
            />
            <span className="vdg-hint">{t('ask.seconds')}</span>
          </div>
        )
        : null}
    </Section>
  )
}

function TrySection({ t }: { t: Translate }) {
  const { busy, error, act } = useAction()
  const [sample, setSample] = useState<keyof typeof TRY_CALLS>('safe')
  const [verdict, setVerdict] = useState<{ decision: string; elapsed_ms: number; backend: string; via: string } | undefined>(undefined)
  return (
    <Section title={t('try.title')} lead={t('try.lead')}>
      <div className="vdg-inline">
        <select className="vdg-select" aria-label={t('try.title')} value={sample} onChange={(event) => { setSample(event.target.value === 'risky' ? 'risky' : 'safe') }}>
          <option value="safe">{t('try.safe')}</option>
          <option value="risky">{t('try.risky')}</option>
        </select>
        <button
          type="button"
          className="vdg-btn"
          disabled={busy !== undefined}
          onClick={() => {
            setVerdict(undefined)
            act('try', async () => { setVerdict(await callPanel('POST', 'test', TRY_CALLS[sample])) })
          }}
        >
          {t(busy === undefined ? 'try.run' : 'try.running')}
        </button>
      </div>
      {verdict === undefined
        ? null
        : (
          <div className="vdg-inline">
            <Badge tone={verdict.decision === 'allow' ? 'ok' : verdict.decision === 'review' ? 'warn' : 'bad'}>
              {['allow', 'review', 'block'].includes(verdict.decision) ? t(`decision.${verdict.decision}` as Key) : verdict.decision}
            </Badge>
            <span className="vdg-hint">{fill(t('try.result'), { decision: verdict.decision, ms: verdict.elapsed_ms, backend: verdict.backend, via: verdict.via })}</span>
          </div>
        )}
      <ErrorLine text={error === undefined ? undefined : fill(t('try.failed'), { error })} />
    </Section>
  )
}

/**
 * Render the engine, policy and records views using the guard services and localized dictionary.
 * 使用审批服务与本地化词典渲染判定引擎、复核规则与记录分区。
 */
export function SettingsPage({ services, t }: { services: Services; t: Translate }) {
  const settings = useSettings(services.form, t)
  const live = useWatch(services.panel)
  // The selected section controls visibility while keeping settings drafts mounted.
  // 所选分区控制显示状态，同时保留已挂载的设置草稿。
  const [view, setView] = useState<SettingsView>('engine')
  // The root is the scroll target when the user changes sections from the sticky navigation.
  // 用户从吸附导航切换分区时，将设置页根节点作为滚动目标。
  const page = useRef<HTMLDivElement>(null)
  // Each navigation control points to its own panel within this settings instance.
  // 每个分区按钮指向当前设置实例中的对应面板。
  const viewId = useId()
  const active = live != null && running(live.job)
  usePolling(services.panel, active ? 1000 : undefined)
  const value = settings.value
  if (settings.status === 'loading' || (settings.status === 'ready' && value === undefined)) {
    return <div className="vdg vdg-page"><p className="vdg-hint">{t('loading')}</p></div>
  }
  if (settings.status === 'unavailable' || value === undefined) {
    return <div className="vdg vdg-page"><div className="vdg-alert warn">{t('unavailable')}</div></div>
  }
  const { disabled, save, saveAsync } = settings
  const refresh = (): void => {
    services.panel.refresh()
    services.cloudModels.refresh()
    services.endpoints.refresh()
  }
  /**
   * Activate the requested settings section and return to its start in the host's scroll pane.
   * 激活指定的设置分区，并在宿主滚动容器内回到分区开头。
   */
  const selectView = (next: SettingsView): void => {
    if (view === next) return
    setView(next)
    page.current?.scrollIntoView({ block: 'start' })
  }
  return (
    <div ref={page} className="vdg vdg-page" data-vulcan-settings-width="full">
      <header className="vdg-page-head" data-vulcan-settings-header>
        <h2>{t('page.title')}</h2>
        <p className="vdg-lead">{t('page.lead')}</p>
      </header>
      <div className="vdg-settings-navigation" role="group" aria-label={t('page.sections')}>
        {SETTINGS_VIEWS.map(item => (
          <button
            key={item}
            id={`${viewId}-${item}-button`}
            type="button"
            aria-pressed={view === item}
            aria-controls={`${viewId}-${item}`}
            onClick={() => { selectView(item) }}
          >
            {t(`page.section.${item}`)}
          </button>
        ))}
      </div>
      {settings.writable ? null : <div className="vdg-alert warn">{t('readOnly')}</div>}
      <ErrorLine text={settings.error} />
      {/* Keep the configuration panels mounted so changing views preserves unsaved rules and prompts.
          保持配置分区挂载，切换时保留尚未保存的规则与提示词。 */}
      <section className="vdg-settings-group" id={`${viewId}-engine`} aria-labelledby={`${viewId}-engine-button`} hidden={view !== 'engine'}>
        <StatusSection services={services} t={t} value={value} live={live} />
        <Section title={t('mode.title')}>
          <Choices
            label={t('mode.title')}
            value={value.mode}
            options={(['auto-preset', 'standalone'] as const).map(item => ({ value: item, title: t(`mode.${item}` as Key), hint: t(`mode.${item}.hint` as Key) }))}
            disabled={disabled}
            onChoose={(next) => { save({ mode: next }) }}
          />
        </Section>
        <Section title={t('backend.title')}>
          <Choices
            label={t('backend.title')}
            value={value.backend}
            options={(['cloud', 'local'] as const).map(item => ({ value: item, title: t(`backend.${item}` as Key), hint: t(`backend.${item}.hint` as Key) }))}
            disabled={disabled}
            onChoose={(next) => { save({ backend: next }) }}
          />
        </Section>
        {live === undefined
          ? <p className="vdg-hint">{t('loading')}</p>
          : live === null
            ? <div className="vdg-alert bad">{t('panel.unavailable')}</div>
            : value.backend === 'cloud'
              ? (
                <>
                  <AccountSection services={services} t={t} account={live.account} />
                  {live.account.signedIn
                    ? (
                      <>
                        <ModelSection
                          services={services}
                          t={t}
                          saved={value.cloudModel}
                          disabled={disabled}
                          onChoose={(model) => {
                            // A lock belongs to the model it was chosen for.
                            void saveAsync({ cloudModel: model === '' ? undefined : model, cloudEndpoint: undefined }).then(() => { services.endpoints.refresh() })
                          }}
                        />
                        <EndpointsSection
                          services={services}
                          t={t}
                          disabled={disabled}
                          onLock={endpoint => lockEndpoint(saveAsync, value.cloudModel, endpoint, t('readOnly'))}
                        />
                      </>
                    )
                    : null}
                </>
              )
              : <LocalSections t={t} live={live} value={value} disabled={disabled} save={save} refresh={refresh} />}
        <OptionsSection t={t} value={value} disabled={disabled} save={save} />
        <TrySection t={t} />
      </section>
      <section className="vdg-settings-group" id={`${viewId}-policy`} aria-labelledby={`${viewId}-policy-button`} hidden={view !== 'policy'}>
        <ReviewSection services={services} t={t} value={value} disabled={disabled} save={save} />
        {value.review === 'off' ? null : <RulesSection t={t} value={value} disabled={disabled} saveAsync={saveAsync} />}
        {value.review === 'off' ? null : <PromptsSection t={t} value={value} disabled={disabled} saveAsync={saveAsync} />}
        <AskSection t={t} value={value} disabled={disabled} save={save} />
      </section>
      <section className="vdg-settings-group" id={`${viewId}-records`} aria-labelledby={`${viewId}-records-button`} hidden={view !== 'records'}>
        {view === 'records' ? (
          <>
            <RecordsSection t={t} value={value} disabled={disabled} save={save} />
            <RecordsPanel t={t} recording={value.recordDecisions} />
          </>
        ) : null}
      </section>
    </div>
  )
}
