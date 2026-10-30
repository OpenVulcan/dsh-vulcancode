import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'

import { INITIAL_STATE, SOURCE_KIND, applyEvent, isSubagent, renderMemoryBlock } from './inject.js'
import { parseSkill } from './index.js'

/** Only the fields `applyEvent` reads; the rest of the event shape is irrelevant here. */
const userMessage = (seq: number, kind: string): SessionEvent =>
  ({ type: 'user/message', seq, time: 0, data: { source: { kind } } }) as unknown as SessionEvent

const compaction = (type: 'compaction/summary' | 'compaction/prune', shadowedSeqs: number[]): SessionEvent =>
  ({ type, seq: 100, time: 0, data: { shadowedSeqs } }) as unknown as SessionEvent

describe('injection state', () => {
  test('records the snapshot message and clears it when a compaction shadows it', () => {
    let state = applyEvent(INITIAL_STATE, userMessage(3, 'user'))
    assert.deepEqual(state, INITIAL_STATE)
    state = applyEvent(state, userMessage(4, SOURCE_KIND))
    assert.deepEqual(state, { injectedSeq: 4, compacted: false })

    assert.deepEqual(applyEvent(state, compaction('compaction/summary', [1, 2, 3])), state)
    assert.deepEqual(applyEvent(state, compaction('compaction/summary', [3, 4])), { injectedSeq: null, compacted: true })
    assert.deepEqual(applyEvent(state, compaction('compaction/prune', [4])), { injectedSeq: null, compacted: true })
  })

  test('a fresh snapshot after compaction keeps the compacted phase', () => {
    const state = applyEvent({ injectedSeq: null, compacted: true }, userMessage(9, SOURCE_KIND))
    assert.deepEqual(state, { injectedSeq: 9, compacted: true })
  })
})

describe('memory block', () => {
  test('wraps guide and snapshot with the phase', () => {
    const text = renderMemoryBlock('  Guide.  ', '## user\nRole', false)
    assert.ok(text.startsWith('<long_term_memory>\n'))
    assert.ok(text.includes('Phase: first_session\nSource: Markdown memory\n\nGuide.\n\n## user\nRole\n</long_term_memory>'))
  })

  test('says when memory is empty and marks the compaction phase', () => {
    const text = renderMemoryBlock('Guide.', '  \n', true)
    assert.ok(text.includes('Phase: after_context_compaction'))
    assert.ok(text.includes('Guide.\n\nMemory is empty so far.\n'))
  })
})

test('subagent sessions are recognized by origin or delegation depth', () => {
  assert.equal(isSubagent({} as SessionHeader), false)
  assert.equal(isSubagent({ origin: 'subagent' } as SessionHeader), true)
  assert.equal(isSubagent({ delegationDepth: 1 } as SessionHeader), true)
})

test('the bundled memory-curator skill parses', () => {
  const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets')
  const skill = parseSkill(readFileSync(path.join(assets, 'memory-curator', 'SKILL.md'), 'utf8'))
  assert.ok(skill.description.length > 0)
  assert.ok(!skill.body.startsWith('---'))
  assert.throws(() => parseSkill('no front matter'))
})
