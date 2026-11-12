import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Translate } from './i18n'
import { MicrophonePicker, ModelFields, ShortcutField } from './fields'
import { openMicrophone, releaseMicrophone, type VoicePreferences, type VoiceStatus } from './shared'

/**
 * One local microphone test and the browser resources it owns.
 * 一次本地麦克风测试及其持有的浏览器资源。
 */
interface MicrophoneTest {
  stream?: MediaStream
  context?: AudioContext
  frame?: number
  timeout?: number
}

/**
 * Release the local audio graph, microphone and timers. No recording is created.
 * 释放本地音频图、麦克风和计时器。测试过程不创建录音。
 */
function disposeTest(test: MicrophoneTest | undefined): void {
  if (test === undefined) return
  if (test.frame !== undefined) cancelAnimationFrame(test.frame)
  window.clearTimeout(test.timeout)
  releaseMicrophone(test.stream)
  if (test.context !== undefined) void test.context.close().catch(() => {})
}

/**
 * Show the regional service status and let the user select and test a local microphone.
 * 显示区域服务状态，并允许用户选择和测试本地麦克风。
 */
export function VoiceSettings({ status, preferences, openAccount, t }: {
  readonly status: VoiceStatus
  readonly preferences: VoicePreferences
  readonly openAccount: () => void
  readonly t: Translate
}) {
  // Settings and the composer read one service status and share one local device preference.
  // 设置和输入框共用一份服务状态及本地设备偏好。
  const state = useSyncExternalStore(status.subscribe, status.getSnapshot)
  const ready = state?.status === 'ready' ? state : undefined
  const authorization = ready?.authorizationId
  const [deviceRevision, setDeviceRevision] = useState(0)
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const [problem, setProblem] = useState('')
  const test = useRef<MicrophoneTest | undefined>(undefined)
  const media = navigator.mediaDevices

  useEffect(() => {
    /**
     * End the local test when this settings page is no longer visible.
     * 设置页失去可见性时结束本地测试。
     */
    const onVisibility = () => {
      if (!document.hidden) return
      disposeTest(test.current)
      test.current = undefined
      setTesting(false)
      setLevel(0)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      disposeTest(test.current)
      test.current = undefined
    }
  }, [])

  useEffect(() => {
    if (test.current === undefined) return
    disposeTest(test.current)
    test.current = undefined
    setTesting(false)
    setLevel(0)
  }, [authorization])

  /**
   * Stop testing and reset the level while retaining the device selection.
   * 停止测试并重置电平，保留设备选择。
   */
  function stopTest(): void {
    disposeTest(test.current)
    test.current = undefined
    setTesting(false)
    setLevel(0)
  }

  /**
   * Show a short live level test after an explicit click. The graph has no output destination.
   * 用户明确点击后进行短时实时电平测试，音频图不连接输出设备。
   */
  async function startTest(): Promise<void> {
    if (media === undefined || typeof AudioContext === 'undefined' || ready === undefined || test.current !== undefined) return
    const operation: MicrophoneTest = {}
    test.current = operation
    setTesting(true)
    setProblem('')
    try {
      const stream = await openMicrophone(preferences.getDevice())
      if (test.current !== operation) { releaseMicrophone(stream); return }
      operation.stream = stream
      setDeviceRevision(value => value + 1)
      const context = new AudioContext()
      operation.context = context
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      context.createMediaStreamSource(stream).connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      operation.timeout = window.setTimeout(stopTest, 8000)
      await context.resume()
      if (test.current !== operation) return
      /**
       * Read the RMS level and update the meter while this test is active.
       * 测试活动期间读取均方根电平并更新电平表。
       */
      const measure = () => {
        if (test.current !== operation) return
        analyser.getFloatTimeDomainData(samples)
        const power = samples.reduce((sum, sample) => sum + sample * sample, 0)
        setLevel(Math.min(100, Math.round(Math.sqrt(power / samples.length) * 300)))
        operation.frame = requestAnimationFrame(measure)
      }
      measure()
    } catch {
      if (test.current === operation) {
        stopTest()
        setProblem(t('micError'))
      }
    }
  }

  // The status reports a site only when the host confirmed the account.
  // 只有宿主确认账号时，状态才包含站点。
  const site = state?.status === 'ready' || state?.status === 'disabled' ? state.site : undefined
  const unavailable = media === undefined || typeof AudioContext === 'undefined'
  return <div className="vvi-settings" data-vulcan-settings-width="full">
    <header className="vvi-head" data-vulcan-settings-header>
      <h2>{t('title')}</h2>
      <p>{t('lead')}</p>
    </header>
    <section className="vvi-card">
      <h3>{t('service')}</h3>
      <p>{t('serviceHint')}</p>
      <div className="vvi-row">
        <div className="vvi-state" role="status">
          <span className="vvi-badge" data-voice-status={state?.status ?? 'loading'}>{t(state?.status ?? 'loading')}</span>
          {site !== undefined && <span>{t(site)}</span>}
        </div>
        <div className="vvi-actions">
          {state?.status === 'signed_out' && <button type="button" className="vvi-primary" onClick={openAccount}>{t('account')}</button>}
          <button type="button" onClick={() => { status.refresh(true) }}>{t('refresh')}</button>
        </div>
      </div>
      {ready !== undefined && <ModelFields ready={ready} preferences={preferences} t={t} />}
      {ready !== undefined && <small>{t('duration').replace('{seconds}', String(ready.maxSeconds))}</small>}
    </section>
    <section className="vvi-card">
      <h3>{t('microphone')}</h3>
      <p>{t('testHint')}</p>
      <div className="vvi-row vvi-device-row">
        <MicrophonePicker preferences={preferences} revision={deviceRevision} disabled={unavailable || testing} t={t} />
        <button type="button" disabled={ready === undefined || unavailable} onClick={() => {
          if (testing) stopTest()
          else void startTest()
        }}>{t(testing ? 'stopTest' : 'test')}</button>
      </div>
      <meter min={0} max={100} value={level} aria-label={t('meter')} />
      {unavailable && <small>{t('unsupported')}</small>}
      {problem !== '' && <small className="vvi-error" role="alert">{problem}</small>}
    </section>
    <section className="vvi-card">
      <h3>{t('shortcut')}</h3>
      <p>{t('shortcutHint')}</p>
      <ShortcutField preferences={preferences} t={t} />
    </section>
  </div>
}
