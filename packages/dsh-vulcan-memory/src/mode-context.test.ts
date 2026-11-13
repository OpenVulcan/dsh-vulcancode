import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAssistantMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { SOURCE_KIND } from './inject.js'
import { clearInactiveMemory, filterMemoryForCompaction, foldModeContext, INITIAL_MODE_CONTEXT } from './mode-context.js'
import { SQLITE_RECALL_SOURCE } from './sqlite/recall.js'

test('switching memory mode hides inactive tool payloads from resumed context and keeps the original log', () => {
  // Seed both backends and an unrelated tool call in the real DSH session.
  // 在真实 DSH 会话中准备两套后端及一个无关工具的调用。
  const source = Session.create(SessionId('mode-context-source'))
  const human = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'human text' }] })
  source.append('user/message', human, { surfaceOp: 'append' })
  for (const name of ['memory_search', 'sqlite_memory_search', 'read_file']) {
    const callId = ToolCallId(name)
    source.append('assistant/message', { turn: 1, step: 1, stream: [], message: createAssistantMessage({
      source: { provider: 'test', model: 'test' }, content: [{ type: 'tool-call', id: callId, name, arguments: '{}' }],
    }) }, { surfaceOp: 'append' })
    source.append('tool/call', { turn: 1, step: 1, callId, name, arguments: '{}' })
    source.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({
      callId, isError: false, content: [{ type: 'text', text: `payload:${name}` }],
    }) }, { surfaceOp: 'append' })
  }
  source.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const restored = Session.create(SessionId('mode-context-resumed'), source.snapshotEvents())
  const compaction = { provider: 'test', model: 'test', purpose: 'compaction' as const, messages: restored.deriveMessages() }
  filterMemoryForCompaction(compaction)
  assert.doesNotMatch(JSON.stringify(compaction.messages), /payload:(?:sqlite_)?memory_search/)
  assert.match(JSON.stringify(compaction.messages), /payload:read_file/)
  const state = () => restored.snapshotEvents().reduce(foldModeContext, INITIAL_MODE_CONTEXT)
  clearInactiveMemory(restored, state(), 'sqlite', 2, 1)
  const vmm = JSON.stringify(restored.deriveMessages())
  assert.doesNotMatch(vmm, /payload:memory_search/)
  assert.match(vmm, /payload:sqlite_memory_search/)
  assert.match(vmm, /payload:read_file/)
  clearInactiveMemory(restored, state(), 'markdown', 3, 1)
  const markdown = JSON.stringify(restored.deriveMessages())
  assert.doesNotMatch(markdown, /payload:(?:sqlite_)?memory_search/)
  assert.match(markdown, /human text/)
  assert.match(JSON.stringify(restored.snapshotEvents()), /payload:memory_search/)
})

test('compaction excludes direct injections from both backends', () => {
  // Keep a regular user message while dropping plugin-owned snapshot and recall messages.
  // 保留普通用户消息，排除插件的快照与召回消息。
  const human = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'human' }] })
  const markdown = createUserMessage({ source: { kind: SOURCE_KIND, form: 'snapshot', sections: [] }, content: [{ type: 'text', text: 'md' }] })
  const vmm = createUserMessage({ source: { kind: SQLITE_RECALL_SOURCE, form: 'recall' }, content: [{ type: 'text', text: 'vector' }] })
  const request = { provider: 'test', model: 'test', purpose: 'compaction' as const, messages: [markdown, human, vmm] }
  filterMemoryForCompaction(request)
  assert.deepEqual(request.messages, [human])
})
