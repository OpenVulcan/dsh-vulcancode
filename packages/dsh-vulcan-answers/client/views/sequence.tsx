/** `ui-sequence` grid. Ported from VulcanCode `answer-graphs.tsx`. */

import type { CSSProperties } from 'react'

import type { AnswerComponent } from '../../src/answer-model'

type SequenceComponent = Extract<AnswerComponent, { kind: 'sequence' }>

/** Actors on top, lifelines below, one row per message, note or phase. */
export function SequenceView({ sequence }: { sequence: SequenceComponent }) {
  let number = 0
  return (
    <figure className="vda-figure vda-sequence-frame">
      <div className="vda-sequence" style={{ '--vda-actors': sequence.actors.length } as CSSProperties}>
        {sequence.actors.map((actor, index) => <span className="vda-sequence-actor" key={index}>{actor}</span>)}
        {sequence.steps.map((step, index) => {
          if (step.kind === 'phase') {
            return <div className="vda-sequence-phase" key={index}><span>{step.text}</span></div>
          }
          if (step.kind === 'note') {
            return (
              <div className="vda-sequence-note" data-single={step.first === step.last || undefined} key={index}
                style={{ gridColumn: `${step.first + 1} / ${step.last + 2}`, '--vda-span': step.last - step.first + 1 } as CSSProperties}>
                {step.text}
              </div>
            )
          }
          number += 1
          const first = Math.min(step.from, step.to)
          const last = Math.max(step.from, step.to)
          const text = sequence.numbered ? `${number}. ${step.text}` : step.text
          return (
            <div className="vda-sequence-message" data-dashed={step.dashed || undefined} data-mark={step.mark} key={index}
              data-direction={step.from === step.to ? 'self' : step.to < step.from ? 'left' : 'right'}
              style={{ gridColumn: `${first + 1} / ${last + 2}`, '--vda-span': last - first + 1 } as CSSProperties}>
              <span>{text || ' '}</span>
            </div>
          )
        })}
      </div>
    </figure>
  )
}
