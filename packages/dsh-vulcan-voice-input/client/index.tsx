import { ComposerVoice, MicrophoneIcon } from './composer'
import type { ClientContext } from './dsh-client'
import { en, zh } from './i18n'
import { ACCOUNT_SECTION, SECTION, VoicePreferences, VoiceStatus } from './shared'
import { VoiceSettings } from './settings'
import { installStyle } from './style'

// Cordis supplies the slot and locale services before loading the client contribution.
// Cordis 在加载浏览器扩展前提供插槽与本地化服务。
export const inject = ['slots', 'locale']

/**
 * Add the OpenVulcan microphone and its settings to dsh without claiming the local voice slot.
 * 将 OpenVulcan 麦克风及设置接入 dsh，并保留本地语音使用的插槽。
 */
export function apply(ctx: ClientContext): void {
  const status = new VoiceStatus()
  const preferences = new VoicePreferences()

  /**
   * Open a known settings section through the sidebar's shell action.
   * 通过侧栏宿主操作打开已知的设置页。
   */
  function open(section: string): void {
    const shell = ctx.slots.entries('sidebar.settings')[0]?.store?.create()
    shell?.actions.openSection(section)
  }

  ctx.effect(installStyle, 'vulcan-voice-input: stylesheet')
  ctx.effect(() => ctx.locale.register(SECTION, { zh, en }), 'vulcan-voice-input: dictionaries')
  ctx.effect(() => {
    /**
     * Invalidate the previous connection's state before reading from the new Host.
     * 在读取新宿主前使上一个连接的状态失效。
     */
    const reconnect = () => { status.reset(); status.refresh() }
    /**
     * Read login changes after returning from the browser's authorization tab.
     * 从浏览器授权页返回后检查登录状态变化。
     */
    const refresh = () => { if (!document.hidden) status.refresh() }
    const stop = ctx.on('connection/reset', reconnect)
    const interval = window.setInterval(refresh, 8000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    refresh()
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      stop()
      status.reset()
    }
  }, 'vulcan-voice-input: Host state')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION,
    order: 25,
    label: () => ctx.locale.bind(SECTION)('title'),
    locale: SECTION,
  }, ({ t }) => <VoiceSettings status={status} preferences={preferences} openAccount={() => { open(ACCOUNT_SECTION) }} t={t} />))
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon', id: SECTION,
  }, MicrophoneIcon))
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: SECTION,
    order: 14,
    locale: SECTION,
  }, ({ t, inputActions, sessionId }) => <ComposerVoice key={sessionId} status={status} preferences={preferences}
    actions={inputActions} openSettings={() => { open(SECTION) }} t={t} />))
}
