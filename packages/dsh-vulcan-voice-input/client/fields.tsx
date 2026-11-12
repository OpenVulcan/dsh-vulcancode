import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { VoiceState } from '../src/contract'
import type { Translate } from './i18n'
import type { VoicePreferences } from './shared'
import { isModifierCode, shortcutFromKey, shortcutLabel } from './shortcut'

/**
 * List local microphone devices and refresh after permission or device changes.
 * 列出本地麦克风，在授权或设备变化后刷新。
 */
function useMicrophones(revision: number): readonly MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    const media = navigator.mediaDevices
    if (media === undefined) return
    let generation = 0
    /**
     * Publish only the most recent enumeration result.
     * 仅发布最近一次设备枚举的结果。
     */
    const refresh = () => {
      const current = ++generation
      void media.enumerateDevices().then(all => {
        if (current !== generation) return
        setDevices(all.filter(item => item.kind === 'audioinput' && item.deviceId !== '' &&
          item.deviceId !== 'default' && item.deviceId !== 'communications'))
      }, () => { if (current === generation) setDevices([]) })
    }
    refresh()
    media.addEventListener('devicechange', refresh)
    return () => {
      generation += 1
      media.removeEventListener('devicechange', refresh)
    }
  }, [revision])
  return devices
}

/**
 * Let either surface select the model and its supported language.
 * 允许在任一界面选择模型及该模型支持的语言。
 */
export function ModelFields({ ready, preferences, t }: {
  readonly ready: Extract<VoiceState, { status: 'ready' }>
  readonly preferences: VoicePreferences
  readonly t: Translate
}) {
  const { site, catalog } = ready
  useSyncExternalStore(preferences.subscribe, preferences.getSnapshot)
  const selection = preferences.selection(site, catalog)
  const current = catalog.models.find(model => model.id === selection.modelId)
  const defaultModel = catalog.models.find(model => model.id === catalog.defaultModelId)
  const languageNames = new Intl.DisplayNames([t('languageLocale')], { type: 'language' })
  // Keep withdrawn preferences visible until the user picks a different value.
  // 保留已下架的选项，直到用户主动改选。
  const retiredLanguage = selection.language !== undefined && !current?.languages.includes(selection.language)
  return <div className="vvi-fields">
    <label>{t('model')}
      <select value={preferences.getModelChoice(site)} onChange={event => { preferences.setModelChoice(site, event.target.value) }}>
        <option value="">{t('siteDefault').replace('{model}', defaultModel?.label ?? catalog.defaultModelId)}</option>
        {current === undefined && <option value={selection.modelId} disabled>{t('retiredChoice').replace('{value}', selection.modelId)}</option>}
        {catalog.models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
      </select>
    </label>
    <label>{t('language')}
      <select value={selection.language ?? ''} disabled={!retiredLanguage && !current?.languages.length}
        onChange={event => { preferences.setLanguage(site, selection.modelId, event.target.value) }}>
        <option value="">{t('autoLanguage')}</option>
        {retiredLanguage && <option value={selection.language} disabled>{t('retiredChoice').replace('{value}', selection.language)}</option>}
        {current?.languages.map(language => <option key={language} value={language}>{languageNames.of(language) ?? language}</option>)}
      </select>
    </label>
  </div>
}

/**
 * Pick the same local microphone from settings or the floating card.
 * 在设置或浮层中选择同一个本地麦克风。
 */
export function MicrophonePicker({ preferences, revision = 0, disabled = false, t }: {
  readonly preferences: VoicePreferences
  readonly revision?: number
  readonly disabled?: boolean
  readonly t: Translate
}) {
  const devices = useMicrophones(revision)
  useSyncExternalStore(preferences.subscribe, preferences.getSnapshot)
  const selected = preferences.getDevice()
  return <select aria-label={t('microphone')} value={selected} disabled={disabled || navigator.mediaDevices === undefined}
    onChange={event => { preferences.setDevice(event.target.value) }}>
    <option value="">{t('system')}</option>
    {selected !== '' && !devices.some(item => item.deviceId === selected) && <option value={selected}>{t('missing')}</option>}
    {devices.map((item, index) => <option key={item.deviceId} value={item.deviceId}>
      {item.label || t('unnamed').replace('{index}', String(index + 1))}
    </option>)}
  </select>
}

/**
 * Record a local push-to-talk shortcut from a focusable read-only field.
 * 在可聚焦的只读字段中录入本地按住说话快捷键。
 */
export function ShortcutField({ preferences, t }: { readonly preferences: VoicePreferences; readonly t: Translate }) {
  useSyncExternalStore(preferences.subscribe, preferences.getSnapshot)
  const chord = preferences.getShortcut()
  // Save an isolated modifier only on release, after allowing a chord to follow.
  // 单独修饰键只在松开时保存，为随后可能出现的组合键留出机会。
  const candidate = useRef('')
  const heldModifiers = useRef(new Set<string>())
  return <div className="vvi-shortcut-row">
    <input aria-label={t('shortcut')} readOnly value={shortcutLabel(chord, t)} placeholder={t('captureShortcut')}
      onBlur={() => { candidate.current = ''; heldModifiers.current.clear() }}
      onKeyDown={event => {
        const next = shortcutFromKey(event.nativeEvent)
        if (isModifierCode(event.code)) {
          if (event.repeat) return
          heldModifiers.current.add(event.code)
          candidate.current = heldModifiers.current.size === 1 ? next : ''
          return
        }
        candidate.current = ''
        if (next === '') return
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) preferences.setShortcut(next)
      }}
      onKeyUp={event => {
        heldModifiers.current.delete(event.code)
        if (candidate.current === '' || candidate.current !== event.code) return
        candidate.current = ''
        event.preventDefault()
        event.stopPropagation()
        preferences.setShortcut(event.code)
      }} />
    <button type="button" disabled={chord === ''} onClick={() => { preferences.setShortcut('') }}>{t('clearShortcut')}</button>
  </div>
}
