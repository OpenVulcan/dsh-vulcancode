import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { filterMemoryForCompaction } from '../mode-context.js'
import { foldSqliteRecall, SQLITE_RECALL_SOURCE, updateSqliteRecall, type RecallState } from './recall.js'

test('SQLite recall replaces preview duplicates, preserves conversation, and clears on disable', () => {
  // Replay real session events so replacement semantics match the model-visible surface.
  // 重放真实会话事件，使替换语义与模型可见的上下文一致。
  const session = Session.create(SessionId('sqlite-recall-test'))
  const source = { kind: SQLITE_RECALL_SOURCE, form: 'recall' } as const
  const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'current question' }] })
  session.append('user/message', createUserMessage({ source, content: [{ type: 'text', text: 'old one' }] }), { surfaceOp: 'append' })
  session.append('user/message', user, { surfaceOp: 'append' })
  session.append('user/message', createUserMessage({ source, content: [{ type: 'text', text: 'old two' }] }), { surfaceOp: 'append' })
  const state = (): RecallState => session.snapshotEvents().reduce(foldSqliteRecall, [])
  updateSqliteRecall(session, state(), 2, 1, 'fresh profile')
  const messages = session.deriveMessages()
  assert.deepEqual(messages.map(message => message.content), [
    user.content, [{ type: 'text', text: 'fresh profile' }],
  ])
  const unchanged = session.snapshotEvents().length
  updateSqliteRecall(session, state(), 2, 2, 'fresh profile')
  assert.equal(session.snapshotEvents().length, unchanged)
  updateSqliteRecall(session, state(), 3, 1, '')
  assert.deepEqual(session.deriveMessages(), [user])
  updateSqliteRecall(session, state(), 4, 1, 'restored profile')
  assert.equal(session.deriveMessages().length, 2)
  const compact = { provider: 'test', model: 'test', purpose: 'compaction' as const, messages: session.deriveMessages() }
  filterMemoryForCompaction(compact)
  assert.deepEqual(compact.messages, [user])
  assert.equal(session.deriveMessages().length, 2)
})
