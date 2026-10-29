/**
 * `ui-math` typesetting with KaTeX. Ported from VulcanCode `answer-math.tsx`. dsh's page already
 * carries KaTeX's stylesheet and fonts for its own math, so only the typesetter is bundled.
 * `trust: false` keeps commands such as `\href` and `\includegraphics` inert.
 */

import katex from 'katex'
import { Fragment, useMemo } from 'react'

import type { AnswerComponent } from '../../src/answer-model'

type MathComponent = Extract<AnswerComponent, { kind: 'math' }>

/** Typeset `tex`, or return KaTeX's parse error. */
function typeset(tex: string, display: boolean): { html: string } | { error: string } {
  try {
    return {
      html: katex.renderToString(tex, {
        displayMode: display,
        throwOnError: true,
        strict: 'ignore',
        trust: false,
        output: 'htmlAndMathml',
        maxSize: 20,
        maxExpand: 500,
      }),
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** One formula; source that KaTeX cannot parse stays visible as code with the error on hover. */
function MathFormula({ display = false, tex }: { display?: boolean; tex: string }) {
  const result = useMemo(() => typeset(tex, display), [display, tex])
  if ('error' in result) {
    return <code className="vda-math-source" data-display={display || undefined} title={result.error}>{tex}</code>
  }
  return <span className={display ? 'vda-math-display' : 'vda-math-inline'} dangerouslySetInnerHTML={{ __html: result.html }} />
}

/** `ui-math`: optional title, displayed equations and a symbol legend. */
export function MathView({ math }: { math: MathComponent }) {
  return (
    <figure className="vda-math">
      {math.title ? <figcaption>{math.title}</figcaption> : null}
      <div className="vda-math-equations">
        {math.equations.map((equation, index) => <MathFormula display key={index} tex={equation} />)}
      </div>
      {math.symbols.length > 0 ? (
        <dl className="vda-math-legend">
          {math.symbols.map((symbol, index) => (
            <Fragment key={index}>
              <dt><MathFormula tex={symbol.symbol} /></dt>
              <dd>{symbol.meaning}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
    </figure>
  )
}
