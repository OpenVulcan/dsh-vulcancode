/**
 * `ui-decision`: a question whose options the reader picks. Picks and an optional note are kept per
 * conversation and go into the composer only on the reader's click. Without a composer on screen the
 * options are read-only with the recommendation shown. Ported from VulcanCode `answer-reply-views.tsx`;
 * comments on other components are not offered in dsh.
 */

import { Check, SendHorizontal, TextCursorInput } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'

import type { AnswerComponent } from '../../src/answer-model'
import { fill, type Translate } from '../i18n'
import type { ReplyHub } from '../reply'

type DecisionComponent = Extract<AnswerComponent, { kind: 'decision' }>

export function DecisionView({ anchor, decision, hub, replyKey, t }: {
  anchor: Element
  decision: DecisionComponent
  hub: ReplyHub
  replyKey: string
  t: Translate
}) {
  useSyncExternalStore(hub.subscribe, hub.getVersion)
  const composer = hub.composerFor(anchor)
  const store = composer === undefined ? undefined : hub.storeFor(composer.sessionId)
  useSyncExternalStore(store?.subscribe ?? noStore, store?.getVersion ?? zero)
  const entry = store?.get(replyKey)
  const picks = entry?.picks ?? []
  const note = entry?.note ?? ''
  const [failed, setFailed] = useState(false)
  const save = (nextPicks: readonly string[], nextNote: string) => {
    setFailed(false)
    store?.set(replyKey, nextPicks.length > 0 || nextNote.trim() ? {
      question: decision.question,
      picks: nextPicks,
      recommended: decision.options.filter((option) => option.recommended).map((option) => option.label),
      note: nextNote,
    } : null)
  }
  const choose = (label: string) => {
    const picked = picks.includes(label)
    if (!decision.multiple) save(picked ? [] : [label], note)
    else save(decision.options.map((option) => option.label).filter((item) => item === label ? !picked : picks.includes(item)), note)
  }
  const deliver = (send: boolean) => {
    if (composer === undefined || store === undefined) return
    const labels = { decisions: t('reply.decisions'), recommended: t('decision.recommended'), noChoice: t('reply.noChoice') }
    setFailed(!store.deliver(composer, send, labels))
  }
  return (
    <section className="vda-figure vda-decision">
      <header className="vda-decision-head">
        <strong>{decision.question}</strong>
        {decision.multiple ? <small>{t('decision.multiple')}</small> : null}
      </header>
      <div aria-label={decision.question} className="vda-decision-options" role={decision.multiple ? 'group' : 'radiogroup'}>
        {decision.options.map((option) => {
          const picked = picks.includes(option.label)
          return (
            <button aria-checked={picked} className="vda-decision-option" data-multiple={decision.multiple || undefined}
              data-recommended={option.recommended || undefined} disabled={store === undefined} key={option.label}
              onClick={() => { choose(option.label) }} role={decision.multiple ? 'checkbox' : 'radio'} type="button">
              <span aria-hidden="true" className="vda-decision-mark">{picked ? <Check size={11} strokeWidth={3} /> : null}</span>
              <span className="vda-decision-text">
                <span>{option.label}</span>
                {option.note ? <small>{option.note}</small> : null}
              </span>
              {option.recommended ? <span className="vda-badge" data-tone="ok">{t('decision.recommended')}</span> : null}
            </button>
          )
        })}
      </div>
      {store === undefined ? <p className="vda-decision-hint">{t('decision.readOnly')}</p> : null}
      {store !== undefined && entry ? (
        <>
          <div className="vda-note">
            <textarea aria-label={t('decision.note')} placeholder={t('decision.note')} rows={2} value={note}
              onChange={(event) => { save(picks, event.target.value) }} />
          </div>
          <footer className="vda-decision-actions">
            {failed ? <small data-tone="no">{t('decision.insertFailed')}</small> : store.size > 1 ? <small>{fill(t('decision.combined'), { count: store.size })}</small> : null}
            <button className="vda-button" data-variant="outline" onClick={() => { deliver(false) }} type="button">
              <TextCursorInput aria-hidden="true" size={14} />{t('decision.insert')}
            </button>
            <button className="vda-button" data-variant="primary" onClick={() => { deliver(true) }} type="button">
              <SendHorizontal aria-hidden="true" size={14} />{t('decision.send')}
            </button>
          </footer>
        </>
      ) : null}
    </section>
  )
}

const noStore = () => () => {}
const zero = () => 0
