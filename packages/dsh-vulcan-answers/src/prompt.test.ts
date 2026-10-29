import assert from 'node:assert/strict'
import { test } from 'node:test'

import { answerContextText, loadAnswerModeTexts, substituteLimits } from './prompt.js'
import { initialView, type AnswerSessionView } from './session-state.js'

const TEXTS = { interactive: 'GUIDE', standard: 'STOP' }
const view = (mode: AnswerSessionView['mode'], everInteractive: boolean, subagent = false): AnswerSessionView => ({ mode, everInteractive, subagent })

test('a session that was never interactive contributes nothing', () => {
  assert.equal(answerContextText(view('standard', false), 'interactive', TEXTS), '')
  assert.equal(answerContextText(initialView({}), 'standard', TEXTS), '')
})

test('an interactive session receives the guide, and the stop note once it turns standard', () => {
  assert.equal(answerContextText(view('interactive', true), 'standard', TEXTS), TEXTS.interactive)
  assert.equal(answerContextText(initialView({}), 'interactive', TEXTS), TEXTS.interactive)
  assert.equal(answerContextText(view('standard', true), 'interactive', TEXTS), TEXTS.standard)
})

test('subagent sessions contribute nothing', () => {
  assert.equal(answerContextText(view('interactive', true, true), 'interactive', TEXTS), '')
  assert.equal(answerContextText(initialView({ origin: 'subagent' }), 'interactive', TEXTS), '')
})

test('the packaged texts load with every placeholder filled', () => {
  const texts = loadAnswerModeTexts()
  assert.ok(texts.interactive.length > 0 && texts.standard.length > 0)
  assert.doesNotMatch(texts.interactive, /\{\{\w+\}\}/u)
  assert.doesNotMatch(texts.standard, /\{\{\w+\}\}/u)
  assert.throws(() => substituteLimits('{{unknown}}', {}))
})

test('the guide offers no component the view cannot render', () => {
  const texts = loadAnswerModeTexts()
  assert.doesNotMatch(texts.interactive, /`ui-(?:code|gallery)\b/u)
})
