import { useEffect, useState, type FormEvent } from 'react'

import type { ProviderCardProps, Remote } from './dsh-client'
import type { Translate } from './i18n'
import {
  draftOf, encodeDraft, LEVELS, modelOptions, PI_AI_NAMESPACE, profileOf, reasoningOp,
  type Draft, type Level, type Mode, type ModelIdentity, type PiAiProfile,
} from './shared'

// A consistent settings revision and the model catalog needed by that provider.
// 同一修订版本的设置及该提供商所需的模型目录。
interface Snapshot {
  readonly revision: number
  readonly writable: boolean
  readonly profile: PiAiProfile
  readonly catalog: readonly ModelIdentity[]
}

// The editor's explicit loading, failure and loaded states.
// 编辑器明确的加载中、失败及已加载状态。
type Resource = { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly snapshot: Snapshot }

/**
 * Read a provider's redacted native settings and, for inherited models, its live catalog.
 * 读取提供商的原生脱敏设置，并在模型继承时读取其当前模型目录。
 */
async function readSnapshot(remote: Remote, provider: string): Promise<Snapshot> {
  // The describe response is the authority for write permission and optimistic concurrency.
  // describe 响应提供写权限和乐观并发控制所需的权威信息。
  const described = await remote.settings.describe()
  if (!described.ok) throw new Error(described.error.message)
  // Read only the namespace that declared this provider card.
  // 仅从声明该提供商卡片的命名空间读取配置。
  const namespace = described.value.namespaces.find(entry => entry.ns === PI_AI_NAMESPACE)
  if (namespace === undefined) throw new Error('The pi-ai settings namespace is unavailable')
  // The card represents an existing provider profile, whose exact ID is supplied by the host.
  // 此卡片代表已存在的提供商配置，其准确标识由宿主提供。
  const profile = profileOf(namespace.value, provider)
  if (profile === undefined) throw new Error('The pi-ai provider is no longer configured')
  // An explicit model list already supplies the IDs and needs no extra catalog request.
  // 显式模型列表已提供模型标识，无需额外读取目录。
  let catalog: readonly ModelIdentity[] = []
  if (profile.models === undefined || profile.models.length === 0) {
    // Inherited model IDs come from the native selector's provider group.
    // 继承的模型标识来自原生选择器的提供商分组。
    const response = await remote.session.modelCatalog()
    if (!response.ok) throw new Error(response.error.message)
    // Preserve a native catalog failure instead of presenting it as an empty provider.
    // 保留原生目录错误，避免将其显示为空提供商。
    const failure = response.value.failures.find(entry => entry.id === provider)
    if (failure !== undefined) throw new Error(failure.message)
    catalog = response.value.groups.find(group => group.id === provider)?.models ?? []
  }
  return { revision: namespace.revision, writable: described.value.writable, profile, catalog }
}

/**
 * Render a collapsible editor for a configured pi-ai provider and use dsh's permission hooks.
 * 为已配置的 pi-ai 提供商渲染可折叠编辑器，并使用 dsh 的权限 Hook。
 */
export function ProviderReasoning({ provider, configured, useRemoteAccess, remote, t }: Omit<ProviderCardProps, 't'> & {
  readonly remote: Remote
  readonly t: Translate
}) {
  // Read access controls visibility; mutation access controls only the save form.
  // 读取权限控制可见性，写入权限只控制保存表单。
  const readable = useRemoteAccess('settings/describe')
  // Save controls follow the current client's settings mutation access.
  // 保存控件遵循当前客户端的设置写入权限。
  const writable = useRemoteAccess('settings/mutate')
  // Defer network reads until the card is opened, and keep drafts mounted on collapse.
  // 等待卡片展开后才发起读取，折叠时保持草稿挂载。
  const [opened, setOpened] = useState(false)
  if (!configured || !readable) return null
  return (
    <details className="vrs" onToggle={event => { if (event.currentTarget.open) setOpened(true) }}>
      <summary>{t('title')}</summary>
      {opened ? <ReasoningEditor key={provider.provider} provider={provider.provider} remote={remote} writable={writable} t={t} /> : null}
    </details>
  )
}

/**
 * Render model selection, editable level mappings and saving for one provider route.
 * 渲染单一提供商路由的模型选择、级别映射编辑与保存操作。
 */
function ReasoningEditor({ provider, remote, writable, t }: {
  readonly provider: string
  readonly remote: Remote
  readonly writable: boolean
  readonly t: Translate
}) {
  // Resource and reload generation track one revision-bearing provider snapshot.
  // 资源与重读代数共同跟踪带修订版本的提供商快照。
  const [resource, setResource] = useState<Resource>({ kind: 'loading' })
  // Increment this generation to start a fresh native settings read.
  // 递增此代数以发起一次新的原生设置读取。
  const [generation, setGeneration] = useState(0)
  // Use the last model the user selected while it remains in the loaded list.
  // 只要最近选中的模型仍在加载后的列表中，就沿用该选择。
  const [selected, setSelected] = useState<string>()
  // Keep unsaved work by model ID when switching models or reloading after a conflict.
  // 切换模型或在冲突后重读时，按模型标识保留未保存的内容。
  const [drafts, setDrafts] = useState<ReadonlyMap<string, Draft>>(() => new Map())
  // A save updates the current revision and publishes success or a specific failure.
  // 保存会更新当前修订版本，并报告成功或具体失败。
  const [saving, setSaving] = useState(false)
  // Retain the failure text beside the draft that could not be saved.
  // 在未保存成功的草稿旁保留失败信息。
  const [error, setError] = useState<string>()
  // Publish confirmation only after the host accepts the mutation.
  // 仅在宿主接受写入后显示保存确认。
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    // Ignore reads from an obsolete load or an unmounted provider card.
    // 忽略已经失效的读取以及已卸载提供商卡片的返回结果。
    let active = true
    readSnapshot(remote, provider).then(snapshot => {
      if (active) setResource({ kind: 'ready', snapshot })
    }, (failure: unknown) => {
      if (active) setResource({ kind: 'failed', message: messageOf(failure) })
    })
    return () => { active = false }
  }, [remote, provider, generation])

  /** Request a fresh snapshot without losing the form drafts. */
  /** 请求最新快照并保留表单草稿。 */
  const reload = (): void => {
    setSaved(false)
    setError(undefined)
    setResource({ kind: 'loading' })
    setGeneration(value => value + 1)
  }
  if (resource.kind === 'loading') return <p className="vrs-form vrs-hint" role="status">{t('loading')}</p>
  if (resource.kind === 'failed') {
    return (
      <div className="vrs-form">
        <p className="vrs-error" role="alert">{t('loadFailed')}: {resource.message}</p>
        <div className="vrs-actions"><button type="button" onClick={reload}>{t('reload')}</button></div>
      </div>
    )
  }

  // Use the last accepted snapshot and initially select its first listed model.
  // 使用最近接受的快照，并默认选中目录中的首个模型。
  const { snapshot } = resource
  // Derive the choices from the adapter's configured or inherited catalog.
  // 从适配器的显式或继承目录生成模型选项。
  const models = modelOptions(snapshot.profile, snapshot.catalog)
  // Use the first listed model when no valid selection has been made.
  // 尚未选择有效模型时使用列表中的第一项。
  const model = models.find(entry => entry.id === selected) ?? models[0]
  if (model === undefined) return <p className="vrs-form vrs-hint">{t('empty')}</p>
  // Read-only clients can still switch models and inspect their saved mappings.
  // 只读客户端仍可切换模型并查看已保存的级别映射。
  const canWrite = writable && snapshot.writable
  // A pending value exists only after the user edited this model.
  // 只有用户编辑过此模型才存在待保存值。
  const pending = drafts.get(model.id)
  // Before editing, show exactly the effective native settings for the model.
  // 编辑前显示该模型当前生效的原生配置。
  const draft = pending ?? draftOf(model.efforts)
  // The encoder reports an error before invalid values can reach the host.
  // 编码器会在无效值到达宿主之前报告错误。
  const encoded = encodeDraft(draft, snapshot.profile.reasoning)

  /** Store the replacement draft for the displayed model. */
  /** 保存当前显示模型的替换草稿。 */
  const change = (next: Draft): void => {
    setSaved(false)
    setError(undefined)
    setDrafts(current => new Map(current).set(model.id, next))
  }
  /** Enable or disable the named level, leaving its wire value for the user to enter. */
  /** 启用或停用指定级别，并由用户填写其传输值。 */
  const toggle = (level: Level, enabled: boolean): void => {
    // Detach the edited dictionary so no other model's draft is mutated.
    // 复制待编辑的字典，避免修改其他模型的草稿。
    const values = { ...draft.values }
    if (enabled) values[level] = ''
    else delete values[level]
    change({ ...draft, values })
  }
  /** Apply this model's draft at the loaded revision and adopt the committed settings. */
  /** 在已加载的修订版本上应用此模型的草稿，并采用提交后的配置。 */
  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!canWrite || saving || pending === undefined || !encoded.ok) return
    setSaving(true)
    setError(undefined)
    setSaved(false)
    try {
      // Use the host's revision check so a concurrently edited model list is never overwritten.
      // 使用宿主的修订检查，防止覆盖并发修改过的模型列表。
      const result = await remote.settings.mutate(PI_AI_NAMESPACE, [
        reasoningOp(snapshot.profile, provider, model.id, encoded.value),
      ], snapshot.revision)
      if (!result.ok) {
        setError(result.error.code === 'settings/conflict' ? t('conflict') : result.error.message)
        return
      }
      // The mutation returns the committed profile, including the revision for the next save.
      // 写入返回提交后的配置及下一次保存需要的修订版本。
      const profile = profileOf(result.value.value, provider)
      if (profile === undefined) {
        setResource({ kind: 'failed', message: 'The committed settings no longer contain this provider' })
        return
      }
      setResource({ kind: 'ready', snapshot: { ...snapshot, profile, revision: result.value.revision } })
      setDrafts(current => {
        // Clear just the model that committed; other unsaved models remain editable.
        // 仅清除已提交模型的草稿，其他未保存模型仍可编辑。
        const remaining = new Map(current)
        remaining.delete(model.id)
        return remaining
      })
      setSaved(true)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="vrs-form" onSubmit={event => { void save(event) }}>
      <p className="vrs-hint">{t('lead')}</p>
      <label className="vrs-control">
        {t('model')}
        <select value={model.id} disabled={saving} onChange={event => { setSelected(event.currentTarget.value); setSaved(false); setError(undefined) }}>
          {models.map(entry => <option key={entry.id} value={entry.id}>{entry.name === entry.id ? entry.id : `${entry.name} · ${entry.id}`}</option>)}
        </select>
      </label>
      <fieldset className="vrs-fields" disabled={!canWrite || saving}>
        <label className="vrs-control">
          {t('mode')}
          <select value={draft.mode} onChange={event => { change({ ...draft, mode: event.currentTarget.value as Mode }) }}>
            <option value="inherit">{t('inherit')}</option>
            <option value="disabled">{t('disabled')}</option>
            <option value="custom">{t('custom')}</option>
          </select>
        </label>
        {draft.mode === 'custom' ? (
          <div className="vrs-levels">
            {LEVELS.map(level => (
              <div key={level} className="vrs-level">
                <label><input type="checkbox" checked={draft.values[level] !== undefined} onChange={event => { toggle(level, event.currentTarget.checked) }} />{level}</label>
                <input
                  type="text"
                  aria-label={`${t('wire')} · ${level}`}
                  disabled={draft.values[level] === undefined}
                  placeholder={level === 'off' ? t('offHint') : t('wire')}
                  value={draft.values[level] ?? ''}
                  onChange={event => { change({ ...draft, values: { ...draft.values, [level]: event.currentTarget.value } }) }}
                />
              </div>
            ))}
          </div>
        ) : null}
        <div className="vrs-actions">
          <button type="submit" disabled={pending === undefined || !encoded.ok}>{t(saving ? 'saving' : 'save')}</button>
        </div>
      </fieldset>
      {!canWrite ? <p className="vrs-hint">{t('readonly')}</p> : null}
      {encoded.ok ? null : (
        <p className="vrs-hint">
          {t(encoded.issue)}{encoded.issue === 'providerDefault' ? `: ${snapshot.profile.reasoning}` : ''}
        </p>
      )}
      {error === undefined ? null : <p className="vrs-error" role="alert">{t('saveFailed')}: {error}</p>}
      {saved ? <><p role="status">{t('saved')}</p><p className="vrs-hint">{t('reselect')}</p></> : null}
      {error === undefined ? null : <div className="vrs-actions"><button type="button" disabled={saving} onClick={reload}>{t('reload')}</button></div>}
    </form>
  )
}

/**
 * Render a caught remote or local failure as a user-visible message.
 * 将捕获的远程或本地错误转为用户可见的消息。
 */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}
