/**
 * The composer pill: shows the session's answer mode and opens a small card that switches it. The
 * switch runs the plugin's slash command, the one write path, so it takes effect from the next
 * request. The pill also registers its composer with the reply hub, which is how a `ui-decision`
 * answer reaches this session's draft. Subagent sessions always answer in standard mode and show no pill.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { ConfigForm, InputSlotProps } from './dsh-client'
import { fill, type Translate } from './i18n'
import type { ReplyHub } from './reply'
import { messageOf, PROJECTION_KEY, type AnswerMode, type AnswerSessionView, type AnswerSettings } from './shared'

export interface QuickInjected {
  readonly hub: ReplyHub
  readonly form: ConfigForm<AnswerSettings>
  /** Whether the session exists on the Host yet; a draft takes no command. */
  readonly materialized: () => boolean
  /** Switch the session; rejects when the Host does not accept it. */
  readonly setMode: (mode: AnswerMode) => Promise<void>
}

const MODES: readonly AnswerMode[] = ['interactive', 'standard']

export function ModePill({ sessionId, useProjection, inputActions, t: translate, hub, form, materialized, setMode }: InputSlotProps & QuickInjected) {
  const t = translate as Translate
  const view = useProjection(PROJECTION_KEY) as AnswerSessionView | undefined
  // The form's methods are class methods, so they are called on the form rather than passed bare.
  const settings = useSyncExternalStore(
    useCallback((listener: () => void) => form.subscribe(listener), [form]),
    useCallback(() => form.getSnapshot(), [form]),
  )
  const root = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const element = root.current
    if (element === null) return undefined
    return hub.register({ sessionId, element, actions: inputActions })
  }, [hub, sessionId, inputActions, view?.subagent])

  useEffect(() => {
    if (!open) return undefined
    // A press or a focus move anywhere else closes the card.
    const onPointer = (event: Event) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && root.current?.contains(document.activeElement)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('focusin', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('focusin', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (view?.subagent === true) return <span hidden ref={root} />
  const fallback: AnswerMode = settings.value?.defaultMode ?? 'interactive'
  const mode = view?.mode ?? fallback
  const draft = !materialized()

  const choose = (next: AnswerMode) => {
    if (next === mode || busy) return
    setBusy(true)
    setError(null)
    setMode(next).then(
      () => { setBusy(false) },
      (cause: unknown) => {
        setBusy(false)
        setError(messageOf(cause))
      },
    )
  }

  return (
    <span className="vda-mode" ref={root}>
      <button aria-expanded={open} aria-haspopup="dialog" className="vda-trigger" onClick={() => { setOpen(!open) }}
        title={t('mode.title')} type="button">
        <span aria-hidden="true" className="vda-dot" data-mode={mode} />
        {`${t('mode.label')} · ${t(mode === 'interactive' ? 'mode.interactive' : 'mode.standard')}`}
      </button>
      {open ? (
        <div aria-label={t('mode.title')} className="vda-popover" role="dialog">
          <p className="vda-popover-title">{t('mode.title')}</p>
          <div className="vda-choices" role="radiogroup">
            {MODES.map((item) => (
              <button aria-checked={item === mode} className="vda-choice" disabled={draft || busy} key={item}
                onClick={() => { choose(item) }} role="radio" type="button">
                <span aria-hidden="true" className="vda-choice-mark" />
                <strong>{t(item === 'interactive' ? 'mode.interactive' : 'mode.standard')}</strong>
                <small>{t(item === 'interactive' ? 'mode.interactive.hint' : 'mode.standard.hint')}</small>
              </button>
            ))}
          </div>
          {error !== null
            ? <p className="vda-popover-foot" data-tone="no">{fill(t('mode.failed'), { error })}</p>
            : <p className="vda-popover-foot">{t(draft ? 'mode.draft' : 'mode.next')}</p>}
        </div>
      ) : null}
    </span>
  )
}
