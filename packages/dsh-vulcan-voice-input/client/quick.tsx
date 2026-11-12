import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { VoiceState } from '../src/contract'
import { MicrophonePicker, ModelFields, ShortcutField } from './fields'
import type { Translate } from './i18n'
import type { VoicePreferences } from './shared'

/**
 * One physical press owns a recording until its matching release.
 * 一次物理按压持有录音，直至对应按键或指针释放。
 */
export type Hold = { readonly pointer: number } | { readonly key: string } | { readonly shortcut: string }

/**
 * Render the microphone and anchor its settings and optional feedback outside the toolbar layout.
 * 渲染麦克风，并将快捷设置与可选提示锚定在工具栏布局之外。
 */
export function VoiceTrigger({ icon, state, preferences, idle, pressed, feedback, pendingAction, openSettings, start, release, cancelPointer, t }: {
  readonly icon: ReactNode
  readonly state: VoiceState | undefined
  readonly preferences: VoicePreferences
  readonly idle: boolean
  readonly pressed: boolean
  readonly feedback?: ReactNode
  readonly pendingAction?: ReactNode
  readonly openSettings: () => void
  readonly start: (hold: Hold) => void
  readonly release: (hold: Hold) => void
  readonly cancelPointer: (pointer: number) => void
  readonly t: Translate
}) {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const timer = useRef<number>()
  const suppressFocus = useRef(false)
  const [expanded, setExpanded] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({})
  const open = idle && expanded
  // Render one anchored surface so recording feedback and quick settings cannot overlap.
  // 只渲染一个锚定浮层，避免录音提示与快捷设置重叠。
  const floating = open || feedback !== undefined

  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    if (idle) return
    window.clearTimeout(timer.current)
    setExpanded(false)
  }, [idle])

  useLayoutEffect(() => {
    if (!floating) return
    /**
     * Keep the fixed card inside the viewport while the composer moves.
     * 输入框移动时，将固定定位浮层留在视口内。
     */
    const place = () => {
      const anchor = button.current?.getBoundingClientRect()
      if (anchor === undefined) return
      // Bound the compact hint separately while keeping both surfaces aligned to the microphone.
      // 为紧凑提示单独限制宽度，并让两种浮层都与麦克风对齐。
      const maxWidth = Math.min(open ? 336 : 280, window.innerWidth - 16)
      const below = window.innerHeight - anchor.bottom
      const above = anchor.top
      setPosition({
        maxWidth, right: Math.max(8, Math.min(window.innerWidth - anchor.right, window.innerWidth - maxWidth - 8)),
        ...(above >= below ? { bottom: below + anchor.height + 6, maxHeight: above - 14 }
          : { top: anchor.bottom + 6, maxHeight: below - 14 }),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [floating, open])

  useEffect(() => {
    if (!open) return
    /**
     * Dismiss the card when a click moves outside its trigger and controls.
     * 点击触发按钮及控件以外的位置时关闭浮层。
     */
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !button.current?.contains(event.target) && !panel.current?.contains(event.target)) {
        setExpanded(false)
      }
    }
    /**
     * Return keyboard focus to the trigger after Escape without reopening the card.
     * 按 Escape 后将键盘焦点交回触发按钮，并避免重新打开浮层。
     */
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (panel.current?.contains(document.activeElement)) {
        suppressFocus.current = true
        button.current?.focus()
        suppressFocus.current = false
      }
      setExpanded(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  /**
   * Delay pointer dismissal long enough to cross the gap to the card.
   * 延迟指针触发的关闭，使指针有时间跨过间隙进入浮层。
   */
  function leave(): void {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (!panel.current?.contains(document.activeElement) && !button.current?.matches(':focus-visible')) setExpanded(false)
    }, 250)
  }

  const ready = state?.status === 'ready' ? state : undefined
  const label = ready === undefined ? `${t(state?.status ?? 'loading')} · ${t('openSettings')}` : `${t('title')} · ${t('holdHint')}`
  return <>
    <button ref={button} type="button" className="vvi-mic" aria-label={label} aria-pressed={pressed}
      aria-controls={floating ? id : undefined} aria-expanded={open} disabled={!idle && !pressed}
      onPointerEnter={event => {
        if (!idle || event.pointerType !== 'mouse') return
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => { setExpanded(true) }, 300)
      }}
      onPointerLeave={leave}
      onFocus={event => { if (idle && !suppressFocus.current && event.currentTarget.matches(':focus-visible')) setExpanded(true) }}
      onBlur={event => {
        if (!panel.current?.contains(event.relatedTarget)) leave()
      }}
      onContextMenu={event => { if (idle) { event.preventDefault(); setExpanded(true) } }}
      onPointerDown={event => {
        if (event.button !== 0 || ready === undefined || !idle) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        window.clearTimeout(timer.current)
        setExpanded(false)
        start({ pointer: event.pointerId })
      }}
      onPointerUp={event => { release({ pointer: event.pointerId }) }}
      onPointerCancel={event => { cancelPointer(event.pointerId) }}
      onLostPointerCapture={event => { cancelPointer(event.pointerId) }}
      onClick={() => { if (idle && ready === undefined) { setExpanded(false); openSettings() } }}
      onKeyDown={event => {
        if (open && !event.shiftKey && (event.key === 'Tab' || event.key === 'ArrowDown')) {
          event.preventDefault()
          panel.current?.querySelector<HTMLElement>('select:not(:disabled), button:not(:disabled), input:not(:disabled)')?.focus()
        } else if (ready !== undefined && (event.code === 'Space' || event.code === 'Enter') &&
          !(event.ctrlKey || event.altKey || event.shiftKey || event.metaKey)) {
          event.preventDefault()
          if (idle && !event.repeat) {
            window.clearTimeout(timer.current)
            setExpanded(false)
            start({ key: event.code })
          }
        }
      }}
      onKeyUp={event => { if (event.code === 'Space' || event.code === 'Enter') release({ key: event.code }) }}
    >{icon}</button>
    {floating && createPortal(<div ref={panel} id={id} role={open ? 'dialog' : undefined} aria-label={open ? t('title') : undefined}
      className={open ? 'vvi-quick' : 'vvi-feedback'} style={position}
      onPointerEnter={() => window.clearTimeout(timer.current)} onPointerLeave={leave}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== button.current) leave()
      }}>
      {(feedback !== undefined || pendingAction !== undefined) && <div className="vvi-feedback-row">{feedback}{pendingAction}</div>}
      {open && <>
        <div className="vvi-quick-head">
          <strong>{t('title')}</strong>
          {ready !== undefined && <small>{t(ready.site)}</small>}
        </div>
        <p>{ready === undefined ? t(state?.status ?? 'loading') : t('holdHint')}</p>
        {ready !== undefined && <ModelFields ready={ready} preferences={preferences} t={t} />}
        <div className="vvi-fields">
          <label>{t('microphone')}<MicrophonePicker preferences={preferences} t={t} /></label>
          <div className="vvi-quick-shortcut"><span>{t('shortcut')}</span><ShortcutField preferences={preferences} t={t} /></div>
        </div>
        <footer><button type="button" onClick={() => { setExpanded(false); openSettings() }}>{t('openSettings')} <span aria-hidden="true">›</span></button></footer>
      </>}
    </div>, document.body)}
  </>
}
