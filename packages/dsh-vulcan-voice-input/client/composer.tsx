import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { VoiceSelection } from '../src/contract'
import type { InputActions } from './dsh-client'
import type { Translate } from './i18n'
import { VoiceTrigger, type Hold } from './quick'
import { openMicrophone, releaseMicrophone, requestTranscript, type VoicePreferences, type VoiceStatus } from './shared'
import { isModifierCode, releasesShortcut, shortcutFromKey } from './shortcut'
import { encodeVoiceInputWav } from './wav'

// MediaRecorder only receives a format supported by the current browser.
// 录音器仅使用当前浏览器支持的格式。
const FORMATS = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']

// Brief recording results disappear independently of ongoing progress.
// 录音结果提示会自动消失，进行中的状态独立显示。
const NOTICE_MS = 2000

// Match VulcanCode's grace period for a lone modifier before opening the microphone.
// 沿用 VulcanCode 的单独修饰键等待时间，再打开麦克风。
const MODIFIER_HOLD_MS = 150

/**
 * One recording bound to the originating composer, draft revision and authorization.
 * 绑定发起输入框、草稿版本及设备授权的一次录音。
 */
interface Recording {
  readonly controller: AbortController
  readonly authorizationId: string
  readonly selection: VoiceSelection
  readonly hold: Hold
  readonly maxSeconds: number
  readonly insertion: ReturnType<InputActions['captureInsertion']>
  readonly chunks: Blob[]
  submit: boolean
  stream?: MediaStream
  recorder?: MediaRecorder
  started?: number
  tick?: number
  deadline?: number
}

/**
 * One localized result notice, with its own identity for the dismissal timer.
 * 一次本地化结果提示，计时器用其独立身份识别。
 */
interface Notice {
  readonly text: string
}

/**
 * Identify the physical press that owns a release or cancellation.
 * 识别该次释放或取消对应的物理按压。
 */
function sameHold(first: Hold, second: Hold): boolean {
  if ('shortcut' in first) return 'shortcut' in second && first.shortcut === second.shortcut
  return 'key' in first ? 'key' in second && first.key === second.key
    : 'pointer' in second && first.pointer === second.pointer
}

/**
 * Release the microphone and both recording clocks.
 * 释放麦克风和两项录音计时。
 */
function release(recording: Recording): void {
  window.clearInterval(recording.tick)
  window.clearTimeout(recording.deadline)
  releaseMicrophone(recording.stream)
  delete recording.stream
}

/**
 * Cancel an operation before releasing its recorder so a stop callback cannot submit it.
 * 在释放录音器前取消操作，防止停止回调提交已取消的录音。
 */
function discard(recording: Recording | undefined): void {
  if (recording === undefined) return
  recording.controller.abort()
  if (recording.recorder?.state === 'recording') recording.recorder.stop()
  release(recording)
}

/**
 * Render the same microphone mark at toolbar or settings navigation size.
 * 按工具栏或设置导航尺寸绘制同一麦克风图标。
 */
export function MicrophoneIcon({ size }: { readonly size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.65}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5.5 11v1a6.5 6.5 0 0 0 13 0v-1M12 18.5V22M9 22h6" />
  </svg>
}

/**
 * Record speech for one composer and return the transcript to its original draft.
 * 为单个输入框录音，并将转写结果回填至原草稿。
 */
export function ComposerVoice({ status, preferences, actions, openSettings, t }: {
  readonly status: VoiceStatus
  readonly preferences: VoicePreferences
  readonly actions: InputActions
  readonly openSettings: () => void
  readonly t: Translate
}) {
  // Read the shared account state without giving the browser access to the device token.
  // 读取共享账号状态，浏览器无需访问设备令牌。
  const state = useSyncExternalStore(status.subscribe, status.getSnapshot)
  const authorization = state?.status === 'ready' ? state.authorizationId : undefined
  const current = useRef<Recording | undefined>(undefined)
  const toolbar = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<'idle' | 'opening' | 'recording' | 'transcribing'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [notice, setNotice] = useState<Notice>()
  const [pending, setPending] = useState<{ readonly text: string; readonly authorizationId: string }>()

  useEffect(() => {
    /**
     * Cancel when the page is hidden or the user presses Escape during capture.
     * 页面隐藏或用户在录音时按 Escape 时取消。
     */
    const cancel = () => {
      if (current.current === undefined) return
      discard(current.current)
      current.current = undefined
      setPhase('idle')
    }
    /**
     * Only react when the page loses visibility.
     * 仅在页面不可见时处理。
     */
    const onVisibility = () => { if (document.hidden) cancel() }
    /**
     * Let Escape dismiss this active recording.
     * 允许 Escape 关闭当前录音。
     */
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', cancel)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', cancel)
      discard(current.current)
      current.current = undefined
    }
  }, [])

  useEffect(() => {
    // Track physical sides because both Ctrl keys share one ctrlKey flag.
    // 左右 Ctrl 共用 ctrlKey 标志，因此按物理键记录状态。
    const heldModifiers = new Set<string>()
    let pendingModifier: { code: string; timer: number } | undefined

    /**
     * Clear a pending single modifier before it can open the microphone.
     * 在单独修饰键打开麦克风前清除等待状态。
     */
    function clearPending(): void {
      if (pendingModifier === undefined) return
      window.clearTimeout(pendingModifier.timer)
      pendingModifier = undefined
    }

    /**
     * Check that the supplied event or focus target belongs to this draft editor.
     * 检查传入的事件目标或焦点是否属于当前草稿编辑器。
     */
    function ownsEditor(element: EventTarget | null): boolean {
      if (!(element instanceof Element)) return false
      const editor = element.closest('[data-composer-input]')
      return editor !== null && toolbar.current?.closest('[data-composer-card]')?.contains(editor) === true
    }

    /**
     * Yield a standalone modifier hold to an ordinary chord before dsh handles the next key.
     * 在 dsh 处理下一个按键前，让单独修饰键录音让位于普通组合键。
     */
    function onOtherDown(event: KeyboardEvent): void {
      if (isModifierCode(event.code)) heldModifiers.add(event.code)
      if (pendingModifier !== undefined && pendingModifier.code !== event.code) clearPending()
      const recording = current.current
      if (recording === undefined || recording.submit || !('shortcut' in recording.hold)) return
      const active = recording.hold.shortcut
      if (isModifierCode(active) && active !== event.code) cancel()
    }

    /**
     * Handle the configured chord only when this conversation's draft editor has focus.
     * 仅在当前会话草稿编辑器聚焦时响应已设置的组合键。
     */
    const onDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !ownsEditor(event.target)) return
      const chord = shortcutFromKey(event)
      if (chord === '' || chord !== preferences.getShortcut()) return
      if (status.getSnapshot()?.status !== 'ready') return
      if (isModifierCode(chord)) {
        if (event.repeat || heldModifiers.size !== 1 || pendingModifier !== undefined || current.current !== undefined) return
        pendingModifier = { code: chord, timer: window.setTimeout(() => {
          pendingModifier = undefined
          if (!document.hidden && ownsEditor(document.activeElement) && preferences.getShortcut() === chord) {
            void start({ shortcut: chord })
          }
        }, MODIFIER_HOLD_MS) }
        return
      }
      event.preventDefault()
      if (!event.repeat) void start({ shortcut: chord })
    }
    /**
     * Release the active shortcut as soon as any of its keys lifts.
     * 快捷键任一组成键松开时结束对应录音。
     */
    const onUp = (event: KeyboardEvent) => {
      heldModifiers.delete(event.code)
      if (pendingModifier?.code === event.code) clearPending()
      const recording = current.current
      if (recording === undefined || recording.submit || !('shortcut' in recording.hold)) return
      if (!releasesShortcut(recording.hold.shortcut, event)) return
      event.preventDefault()
      releaseHold(recording.hold)
    }
    /**
     * Forget pending keys when the document may no longer receive their releases.
     * 文档可能收不到松键事件时清除等待中的按键。
     */
    function resetKeys(): void {
      heldModifiers.clear()
      clearPending()
    }
    /**
     * Clear the hold delay when the page is hidden.
     * 页面隐藏时清除长按等待状态。
     */
    const onHidden = () => { if (document.hidden) resetKeys() }
    window.addEventListener('keydown', onOtherDown, true)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', resetKeys)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      resetKeys()
      window.removeEventListener('keydown', onOtherDown, true)
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', resetKeys)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [actions, preferences, status, t])

  useEffect(() => {
    setPending(undefined)
    setNotice(undefined)
    if (current.current !== undefined && current.current.authorizationId !== authorization) {
      discard(current.current)
      current.current = undefined
      setPhase('idle')
    }
  }, [authorization])

  useEffect(() => {
    if (notice === undefined) return
    // An earlier notice's timer must not clear feedback from a newer recording.
    // 旧提示的计时器不能清除新录音产生的提示。
    const timer = window.setTimeout(() => {
      setNotice(current => current === notice ? undefined : current)
    }, NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  /**
   * Verify the recording is still attached to this composer and the same login.
   * 确认录音仍属于当前输入框和同一次登录。
   */
  function stillCurrent(recording: Recording): boolean {
    const snapshot = status.getSnapshot()
    return current.current === recording && !recording.controller.signal.aborted &&
      snapshot?.status === 'ready' && snapshot.authorizationId === recording.authorizationId
  }

  /**
   * Encode and upload the stopped recording, then use dsh's revision-aware draft action.
   * 编码并上传已停止的录音，再使用 dsh 带版本校验的草稿操作。
   */
  async function finish(recording: Recording, mimeType: string): Promise<void> {
    release(recording)
    if (!stillCurrent(recording)) return
    try {
      // Missing chunks and silent PCM have the same outcome as a successful blank transcript.
      // 没有录音片段、PCM 静音与转写成功但文本为空属于同一种结果。
      const wav = recording.chunks.length === 0
        ? null
        : await encodeVoiceInputWav(new Blob(recording.chunks, { type: mimeType }), recording.maxSeconds)
      if (!stillCurrent(recording)) return
      // Text stays empty when there is no audio to send.
      // 没有可上传的音频时，转写文本保持为空。
      let text = ''
      if (wav !== null) {
        const result = await requestTranscript(wav, recording.authorizationId, recording.selection, recording.controller.signal)
        if (!stillCurrent(recording)) return
        if (!result.ok) {
          const retry = result.retryAfter === undefined ? '' : ' ' + t('retry').replace('{seconds}', String(result.retryAfter))
          setNotice({ text: t(result.code) + retry })
          if (result.code === 'signed_out' || result.code === 'selection_unavailable') status.refresh(true)
          return
        }
        text = result.text.trim()
      }
      if (text === '') {
        setNotice({ text: t('noSpeech') })
      } else if (!actions.insertText(text, recording.insertion)) {
        setPending({ text, authorizationId: recording.authorizationId })
        setNotice({ text: t('draftChanged') })
      }
    } catch {
      if (stillCurrent(recording)) setNotice({ text: t('unavailable') })
    } finally {
      if (current.current === recording) {
        current.current = undefined
        setPhase('idle')
      }
    }
  }

  /**
   * Start recording for a physical hold while the account is ready.
   * 账号就绪时，为一次物理按压启动录音。
   */
  async function start(hold: Hold): Promise<void> {
    const ready = status.getSnapshot()
    if (ready?.status !== 'ready') return
    if (current.current !== undefined) return
    // Prevent recording with an unavailable preference before requesting the microphone.
    // 所选参数已不可用时，在打开麦克风前提示用户。
    const selection = preferences.selection(ready.site, ready.catalog)
    const model = ready.catalog.models.find(entry => entry.id === selection.modelId)
    if (model === undefined || (selection.language !== undefined && !model.languages.includes(selection.language))) {
      setNotice({ text: t('selection_unavailable') })
      return
    }
    setNotice(undefined)
    setPending(undefined)
    const mimeType = typeof MediaRecorder === 'undefined' ? undefined : FORMATS.find(type => MediaRecorder.isTypeSupported(type))
    if (mimeType === undefined || navigator.mediaDevices === undefined) { setNotice({ text: t('unsupported') }); return }
    const recording: Recording = {
      controller: new AbortController(), authorizationId: ready.authorizationId, hold,
      maxSeconds: ready.maxSeconds, selection,
      insertion: actions.captureInsertion(), chunks: [], submit: false,
    }
    current.current = recording
    setPhase('opening')
    try {
      const stream = await openMicrophone(preferences.getDevice())
      if (!stillCurrent(recording)) { releaseMicrophone(stream); return }
      recording.stream = stream
      const recorder = new MediaRecorder(stream, { mimeType })
      recording.recorder = recorder
      recorder.ondataavailable = event => { if (event.data.size !== 0) recording.chunks.push(event.data) }
      recorder.onstop = () => {
        if (recording.submit) {
          void finish(recording, recorder.mimeType)
        } else if (stillCurrent(recording)) {
          // An unplugged microphone can stop MediaRecorder without a user action.
          // 拔出麦克风可能在没有用户操作时停止录音器。
          cancel()
          setNotice({ text: t('micError') })
        }
      }
      recorder.onerror = () => {
        if (!stillCurrent(recording)) return
        cancel()
        setNotice({ text: t('micError') })
      }
      recorder.start()
      const started = performance.now()
      recording.started = started
      setSeconds(ready.maxSeconds)
      setPhase('recording')
      recording.tick = window.setInterval(() => {
        setSeconds(Math.max(0, ready.maxSeconds - Math.floor((performance.now() - started) / 1000)))
      }, 250)
      recording.deadline = window.setTimeout(() => { submitRecording(recording) }, ready.maxSeconds * 1000)
    } catch {
      if (current.current === recording) {
        cancel()
        setNotice({ text: t('micError') })
      }
    }
  }

  /**
   * Submit audio when the matching hold ends after the minimum recording duration.
   * 对应的按压松开且满足最短录音时长时提交音频。
   */
  function releaseHold(hold: Hold): void {
    const recording = current.current
    if (recording === undefined || recording.submit || !sameHold(recording.hold, hold)) return
    if (recording.started === undefined || recording.recorder?.state !== 'recording') { cancel(); return }
    // Measure duration at release so an asynchronous MediaRecorder stop cannot extend a short press.
    // 在松开时计算时长，避免 MediaRecorder 异步停止将短按误算为有效录音。
    const elapsed = performance.now() - recording.started
    if (elapsed < 250) { cancel(); setNotice({ text: t('tooShort') }); return }
    submitRecording(recording)
  }

  /**
   * Commit a recording once, whether released by the user or stopped at the duration limit.
   * 录音由用户松开或达到时限时只提交一次。
   */
  function submitRecording(recording: Recording): void {
    if (!stillCurrent(recording) || recording.submit || recording.recorder?.state !== 'recording') return
    // Mark the submission before stopping so a later release cannot enqueue another upload.
    // 先标记已提交再停止录音器，防止稍后的松开操作重复上传。
    recording.submit = true
    window.clearInterval(recording.tick)
    window.clearTimeout(recording.deadline)
    setPhase('transcribing')
    recording.recorder.stop()
  }

  /**
   * Cancel after an interrupted pointer gesture, without interrupting a normal release.
   * 指针手势意外中断时取消，不打断正常释放。
   */
  function cancelPointer(pointer: number): void {
    const recording = current.current
    if (recording !== undefined && !recording.submit && sameHold(recording.hold, { pointer })) cancel()
  }

  /**
   * Cancel capture or upload and return the toolbar to idle.
   * 取消录音或上传，使工具栏回到空闲状态。
   */
  function cancel(): void {
    discard(current.current)
    current.current = undefined
    setPhase('idle')
  }

  /**
   * Insert a retained transcript only after the user explicitly confirms the new draft position.
   * 用户明确确认新的草稿位置后，才插入保留的转写。
   */
  function insertPending(): void {
    const snapshot = status.getSnapshot()
    if (pending === undefined || snapshot?.status !== 'ready' || pending.authorizationId !== snapshot.authorizationId ||
        !actions.insertText(pending.text, actions.captureInsertion())) return
    setPending(undefined)
    setNotice(undefined)
  }

  // Keep status and recovery actions in the microphone's floating surface throughout the operation.
  // 录音全程将状态与恢复操作放在麦克风浮层中。
  const feedback = phase !== 'idle' || notice !== undefined ? <>
    {phase === 'recording' && <span className="vvi-recording">
      <span className="vvi-dot" aria-hidden="true" /><span role="status">{t('recording')}</span>
      <span className="vvi-timer" role="timer">{seconds}s</span>
    </span>}
    {(phase === 'opening' || phase === 'transcribing') && <span role="status">{t(phase)}</span>}
    {phase !== 'idle' && <button type="button" onClick={cancel}>{t('cancel')}</button>}
    {notice !== undefined && <span className="vvi-notice" role="status">{notice.text}</span>}
  </> : undefined

  return <div ref={toolbar} className="vvi-composer">
    <VoiceTrigger icon={<MicrophoneIcon size={17} />} state={state} preferences={preferences} feedback={feedback}
      pendingAction={pending === undefined ? undefined : <button type="button" onClick={insertPending}>{t('insert')}</button>}
      idle={phase === 'idle'} pressed={phase === 'opening' || phase === 'recording'}
      openSettings={openSettings} start={hold => { void start(hold) }} release={releaseHold} cancelPointer={cancelPointer} t={t} />
  </div>
}
