import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { SqliteStore } from './store.js'
import { postaction, precheck, TurnDialogue } from './workflow.js'

// Use the same project identity and scoped records as the host.
// 使用和宿主相同的项目标识和范围记录。
const project = 'dshproject-1234567890abcdef'

test('completed turn uses only committed human and assistant text', () => {
  // Drive the tracker with real DSH session events.
  // 使用真实 DSH 会话事件驱动跟踪器。
  const session = Session.create(SessionId('vmm-turn-test'))
  const tracker = new TurnDialogue()
  tracker.observe(session.append('turn/start', { turn: 1 }))
  tracker.observe(session.append('user/message', createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: 'Prefer short answers. api_key=fixture-secret' }],
  }), { surfaceOp: 'append' }))
  tracker.observe(session.append('user/message', createUserMessage({
    source: { kind: 'vulcan-sqlite-memory', form: 'recall' }, content: [{ type: 'text', text: 'Hidden recall' }],
  }), { surfaceOp: 'append' }))
  tracker.observe(session.append('assistant/message', {
    turn: 1, step: 1, stream: [], message: createAssistantMessage({
      source: { provider: 'test', model: 'test' },
      content: [{ type: 'text', text: 'Understood.' }],
    }),
  }, { surfaceOp: 'append' }))
  assert.deepEqual(tracker.observe(session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })), {
    user: 'Prefer short answers. [redacted]', timeline: [], assistant: 'Understood.',
  })
  tracker.observe(session.append('turn/start', { turn: 2 }))
  assert.equal(tracker.observe(session.append('turn/end', { turn: 2, reason: { kind: 'blocked' } })), undefined)
})

test('precheck searches planned text and uses only reviewed candidates', async () => {
  // Give the reviewer one in-scope candidate and preserve the exact vector query.
  // 向审核阶段提供一条范围内候选，并保留准确的向量查询。
  const row = { id: randomUUID(), revision: randomUUID(), scope: 'project' as const, kind: 'memory' as const,
    project, title: 'Build', body: 'Publish with a signed tag.', updated: 0 }
  const calls: string[] = []
  const result = await precheck('How do we release?', [], async (purpose, input) => {
    calls.push(purpose)
    if (purpose === 'pcl1') return { reason: 'Needs project history', need_memory: true, queries: ['release signing'] }
    assert.deepEqual(Reflect.get(input, 'search_queries'), ['release signing'])
    return { selected_candidate_numbers: [1] }
  }, async queries => {
    assert.deepEqual(queries, ['release signing'])
    return [row]
  })
  assert.deepEqual(result, [row])
  assert.deepEqual(calls, ['pcl1', 'pcl2'])
  assert.deepEqual(await precheck('Hello', [], async () => ({ reason: '', need_memory: false, queries: [] }),
    async () => assert.fail('Should not retrieve on a negative precheck.')), [])
})

test('postaction reviews both record types and commits once with revision-checked archival', async () => {
  // Open the actual database and verify that an obsolete reviewed revision rolls back the batch.
  // 打开真实数据库，验证审核版本过期时整批回滚。
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-vmm-workflow-'))
  const store = await SqliteStore.open(root)
  try {
    const prior = store.write(project, { action: 'add', kind: 'memory', scope: 'project', title: 'Build', body: 'Sign with key A.' })
    assert.ok(prior)
    const turn = { id: 'session/15', time: 0, dialogue: { user: 'Use key B and keep output concise.', assistant: 'Confirmed.', timeline: [] } }
    const result = await postaction(turn, project, [], async (purpose, input) => {
      if (purpose === 'ptl1') {
        assert.deepEqual(Reflect.get(input, 'target_turn').raw_turn, turn.dialogue)
        return { turn_id: turn.id, user_input_kind: 'statement',
          memory_nodes: [{ category: 1, abstract: 'Sign with key B.', details: null,
            evidence_source: 'user_asserted', admission: 'keep', admission_reason: '' }],
          profile_nodes: [{ profile_type: 0, content: 'Concise output',
            evidence_source: 'user_asserted', admission: 'keep', admission_reason: '' }] }
      }
      assert.equal(purpose, 'ptl2')
      assert.equal(Reflect.get(input, 'memory')[0].similar_memories[0].memory_id, prior.id)
      return { memory: { accepted_candidates: [{ candidate_index: 0, supersede_memory_ids: [prior.id] }], dropped_candidates: null },
        user: { accepted_candidates: [{ candidate_index: 0, normalized_content: 'Prefer concise output.',
          priority: 'P1', level: 'L2', supersede_node_ids: null }], invalid_candidate_indexes: null }, project: null }
    }, async () => [prior])
    const revision = store.consent().revision
    assert.equal(store.commitDistillation(project, turn.id, revision, result.changes, result.retire), true)
    assert.equal(store.commitDistillation(project, turn.id, revision, result.changes, result.retire), false)
    assert.deepEqual(store.list(project, 'memory', 10).map(row => row.body), ['Sign with key B.'])
    assert.deepEqual(store.list(project, 'profile', 10).map(row => row.body), ['Prefer concise output.'])
    assert.throws(() => store.commitDistillation(project, 'session/16', revision, result.changes, result.retire), /does not exist/)
    assert.equal(store.hasDistilled('session/16'), false)
    assert.equal(store.list(project, 'memory', 10).length, 1)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})
