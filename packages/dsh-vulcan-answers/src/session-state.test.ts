import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { SessionEvent } from '@deepseek-ai/dsh-session'

import { applySessionRecord, effectiveMode, initialView, isSubagentHeader, MODE_RECORD, type AnswerSessionView } from './session-state.js'

function record(data: unknown, type: string = MODE_RECORD): SessionEvent {
  return { type, seq: 1, time: 0, data, ignorable: true } as unknown as SessionEvent
}

const TOP = initialView({})

test('a session starts unrecorded and follows the default until a record arrives', () => {
  assert.deepEqual(TOP, { mode: null, everInteractive: false, subagent: false })
  assert.equal(effectiveMode(TOP, 'interactive'), 'interactive')
  assert.equal(effectiveMode(TOP, 'standard'), 'standard')
})

test('the latest mode record wins and interactive is remembered after switching back', () => {
  const interactive = applySessionRecord(TOP, record({ mode: 'interactive' }))
  assert.deepEqual(interactive, { mode: 'interactive', everInteractive: true, subagent: false })
  const standard = applySessionRecord(interactive, record({ mode: 'standard' }))
  assert.deepEqual(standard, { mode: 'standard', everInteractive: true, subagent: false })
  assert.equal(effectiveMode(standard, 'interactive'), 'standard')
})

test('a session that was only ever standard never counts as interactive', () => {
  const standard = applySessionRecord(TOP, record({ mode: 'standard' }))
  assert.deepEqual(standard, { mode: 'standard', everInteractive: false, subagent: false })
})

test('subagent sessions are standard whatever was recorded or configured', () => {
  assert.equal(isSubagentHeader({ origin: 'subagent' }), true)
  assert.equal(isSubagentHeader({ delegationDepth: 2 }), true)
  assert.equal(isSubagentHeader({ delegationDepth: 0 }), false)
  const child = applySessionRecord(initialView({ origin: 'subagent' }), record({ mode: 'interactive' }))
  assert.equal(effectiveMode(child, 'interactive'), 'standard')
})

test('unrelated events, malformed records and repeated values keep the same state reference', () => {
  const interactive: AnswerSessionView = applySessionRecord(TOP, record({ mode: 'interactive' }))
  assert.equal(applySessionRecord(TOP, { type: 'turn/start', seq: 1, time: 0, data: {} } as unknown as SessionEvent), TOP)
  assert.equal(applySessionRecord(TOP, record({ mode: 'fancy' })), TOP)
  assert.equal(applySessionRecord(TOP, record(null)), TOP)
  assert.equal(applySessionRecord(TOP, record({ mode: 'interactive' }, 'plugin:someone-else/mode')), TOP)
  assert.equal(applySessionRecord(interactive, record({ mode: 'interactive' })), interactive)
})
