/**
 * The model-facing answer mode instructions. Both texts are English package assets; the interactive one
 * names the component limits as `{{max_rows}}` and `{{max_series}}`, which are substituted here from
 * the parser's own constants, so the context is registered with interpolation off.
 */

import { readFileSync } from 'node:fs'

import { ANSWER_CHART_MAX_SERIES, ANSWER_COMPONENT_MAX_ROWS } from './limits.js'
import { effectiveMode, type AnswerMode, type AnswerSessionView } from './session-state.js'

/** The two instruction texts a session can receive. */
export interface AnswerModeTexts {
  /** The component guide, sent while a session is interactive. */
  readonly interactive: string
  /** The stop note, sent once a session that was interactive turns standard. */
  readonly standard: string
}

/** Replace every `{{name}}` with its value; a placeholder without a value is a packaging error. */
export function substituteLimits(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/gu, (_whole, key: string) => {
    const value = values[key]
    if (value === undefined) throw new Error(`answer mode prompt: no value for {{${key}}}`)
    return value
  })
}

/** Read and fill the packaged instruction texts. */
export function loadAnswerModeTexts(): AnswerModeTexts {
  const read = (file: string) => readFileSync(new URL(`../assets/prompts/${file}`, import.meta.url), 'utf8').trim()
  return Object.freeze({
    interactive: substituteLimits(read('answer-mode-interactive.md'), {
      max_rows: String(ANSWER_COMPONENT_MAX_ROWS),
      max_series: String(ANSWER_CHART_MAX_SERIES),
    }),
    standard: read('answer-mode-standard.md'),
  })
}

/**
 * The context one session receives: the guide while interactive, the stop note once an interactive
 * session turned standard, and nothing for subagents or sessions that were never interactive.
 */
export function answerContextText(view: AnswerSessionView, defaultMode: AnswerMode, texts: AnswerModeTexts): string {
  if (view.subagent) return ''
  if (effectiveMode(view, defaultMode) === 'interactive') return texts.interactive
  return view.everInteractive ? texts.standard : ''
}
