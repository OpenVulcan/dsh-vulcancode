import type { VoiceCatalog, VoiceReply, VoiceSelection, VoiceState } from '../src/contract'
import { normalizeShortcut } from './shortcut'

// The dsh client bundler checks this identity against the package manifest.
// dsh 客户端打包器会将此标识与包清单比对。
export const PACKAGE_NAME = '@openvulcan/dsh-vulcan-voice-input'

// One same-origin route prefix and settings entry for the microphone UI.
// 麦克风界面共用的同源路由前缀及设置页标识。
const BASE = '/api/vulcan-voice-input/'
export const SECTION = 'vulcan-voice-input'
export const ACCOUNT_SECTION = 'vulcan-account'
// Microphone IDs belong to a browser origin and stay on this device.
// 麦克风标识属于浏览器来源，仅保存在本设备。
const DEVICE_KEY = 'vulcan.dsh.voice-input-device.v1'
// Keep preferences for each account site and published model separately.
// 按账号站点与发布模型分别保存偏好。
const MODEL_KEY = 'vulcan.dsh.voice-input-model.v1'
const LANGUAGE_KEY = 'vulcan.dsh.voice-input-language.v1'
const SHORTCUT_KEY = 'vulcan.dsh.voice-input-shortcut.v1'

/**
 * The regional identities which can publish voice models.
 * 可以发布语音模型的站点标识。
 */
type VoiceSite = Extract<VoiceState, { status: 'ready' }>['site']

/**
 * A shared host status snapshot for the toolbar and settings page.
 * 输入框工具栏和设置页共用的宿主状态快照。
 */
export class VoiceStatus {
  // Start with no observed state and ignore replies from superseded requests.
  // 初始状态未知，并忽略已被替换的请求结果。
  #state: VoiceState | undefined
  #request: AbortController | undefined
  #listeners = new Set<() => void>()

  /**
   * Subscribe one rendered consumer and return its disposer.
   * 订阅一个已渲染的消费者并返回注销函数。
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /**
   * Return the last observed status, or undefined before the first read.
   * 返回最近观察到的状态，首次读取前返回 undefined。
   */
  readonly getSnapshot = (): VoiceState | undefined => this.#state

  /**
   * Read the account status, optionally asking the Host to refresh the publication.
   * 读取账号状态，并可显式要求宿主刷新发布目录。
   */
  refresh(force = false): void {
    if (this.#request !== undefined && !force) return
    this.#request?.abort()
    const request = new AbortController()
    this.#request = request
    void fetch(`${BASE}state${force ? '?refresh=1' : ''}`, {
      signal: request.signal, cache: 'no-store',
    }).then(async response => {
      if (!response.ok) throw new Error('Voice status unavailable')
      return await response.json() as VoiceState
    }).then(state => {
      if (this.#request !== request) return
      this.#publish(state)
    }, () => {
      if (this.#request !== request) return
      this.#publish({ status: 'unavailable' })
    }).finally(() => {
      if (this.#request === request) this.#request = undefined
    })
  }

  /**
   * Invalidate the snapshot across host connections and drop pending replies.
   * 在宿主连接切换时使快照失效，并丢弃未完成的响应。
   */
  reset(): void {
    this.#request?.abort()
    this.#request = undefined
    this.#publish(undefined)
  }

  /**
   * Publish a new snapshot to mounted consumers.
   * 向已挂载的消费者发布新快照。
   */
  #publish(state: VoiceState | undefined): void {
    this.#state = state
    for (const listener of this.#listeners) listener()
  }
}

/**
 * Send an authorization-bound microphone WAV to the owning dsh Host.
 * 将绑定至设备授权的麦克风 WAV 发给所属 dsh 宿主。
 */
export async function requestTranscript(
  wav: Blob, authorizationId: string, selection: VoiceSelection, signal: AbortSignal,
): Promise<VoiceReply> {
  const response = await fetch(`${BASE}transcriptions`, {
    method: 'POST', body: wav, signal, cache: 'no-store',
    headers: {
      'content-type': 'audio/wav', 'x-vulcan-voice-authorization': authorizationId,
      'x-vulcan-voice-model': selection.modelId,
      ...(selection.language === undefined ? {} : { 'x-vulcan-asr-language': selection.language }),
    },
  })
  return await response.json() as VoiceReply
}

/**
 * Share local voice preferences between settings and all composer cards.
 * 在设置页与所有输入框浮层之间共享本地语音偏好。
 */
export class VoicePreferences {
  // Memory also keeps the selected values usable when browser storage is unavailable.
  // 浏览器存储不可用时，仍在内存保留当前选择。
  #values = new Map<string, string>()
  #listeners = new Set<() => void>()
  #revision = 0

  /**
   * Register a listener and return its disposer.
   * 注册监听器并返回注销函数。
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /**
   * Return a stable snapshot until a preference changes.
   * 在偏好变更前返回稳定的快照。
   */
  readonly getSnapshot = (): number => this.#revision

  /**
   * Return the selected device ID, or an empty string for system default.
   * 返回所选设备标识，系统默认时返回空字符串。
   */
  getDevice(): string { return this.#read(DEVICE_KEY) }

  /**
   * Save a device ID or clear it to use the system default.
   * 保存设备标识，或清空以使用系统默认。
   */
  setDevice(device: string): void { this.#write(DEVICE_KEY, device) }

  /**
   * Return the saved model ID, or an empty string to follow the site default.
   * 返回已保存的模型标识，空字符串表示跟随站点默认。
   */
  getModelChoice(site: VoiceSite): string { return this.#read(`${MODEL_KEY}:${site}`) }

  /**
   * Save a preferred model ID for this site, or clear it to follow the site default.
   * 保存当前站点的首选模型标识，或清空以跟随站点默认。
   */
  setModelChoice(site: VoiceSite, id: string): void { this.#write(`${MODEL_KEY}:${site}`, id) }

  /**
   * Save a language hint for this published model, or clear it for automatic detection.
   * 为当前发布模型保存优先语言，或清空以自动识别。
   */
  setLanguage(site: VoiceSite, id: string, language: string): void { this.#write(`${LANGUAGE_KEY}:${site}:${id}`, language) }

  /**
   * Resolve the recorded preference against the site default while preserving withdrawn selections.
   * 结合站点默认值解析已保存的偏好，并保留已下架的选择。
   */
  selection(site: VoiceSite, catalog: VoiceCatalog): VoiceSelection {
    const choice = this.getModelChoice(site)
    const modelId = choice === '' ? catalog.defaultModelId : choice
    const language = this.#read(`${LANGUAGE_KEY}:${site}:${modelId}`)
    return { modelId, ...(language === '' ? {} : { language }) }
  }

  /**
   * Return the local push-to-talk chord, or an empty string when unset.
   * 返回本地按住说话组合键，未设置时返回空字符串。
   */
  getShortcut(): string { return normalizeShortcut(this.#read(SHORTCUT_KEY)) }

  /**
   * Store a canonical shortcut chord, or remove it.
   * 保存规范的快捷键组合，或清除它。
   */
  setShortcut(chord: string): void { this.#write(SHORTCUT_KEY, chord) }

  /**
   * Read one saved string with an in-memory value for the current window.
   * 读取已保存的字符串，并在当前窗口保留内存值。
   */
  #read(key: string): string {
    const cached = this.#values.get(key)
    if (cached !== undefined) return cached
    let value = ''
    try { value = localStorage.getItem(key) ?? '' } catch { /* Storage may be blocked. 存储可能被禁用。 */ }
    this.#values.set(key, value)
    return value
  }

  /**
   * Update one preference and notify mounted selectors.
   * 更新一项偏好并通知已挂载的选择器。
   */
  #write(key: string, value: string): void {
    if (value === this.#read(key)) return
    this.#values.set(key, value)
    try {
      if (value === '') localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch { /* The selection remains active in this window. 选择在当前窗口仍然有效。 */ }
    this.#revision += 1
    for (const listener of this.#listeners) listener()
  }
}

/**
 * Open the selected microphone exactly, or the system default if no device was selected.
 * 精确打开已选麦克风，未选择时打开系统默认设备。
 */
export function openMicrophone(device: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: device === '' ? true : { deviceId: { exact: device } } })
}

/**
 * Release every track held by a cancelled or completed operation.
 * 释放已取消或已完成操作持有的所有音轨。
 */
export function releaseMicrophone(stream: MediaStream | undefined): void {
  stream?.getTracks().forEach(track => track.stop())
}
