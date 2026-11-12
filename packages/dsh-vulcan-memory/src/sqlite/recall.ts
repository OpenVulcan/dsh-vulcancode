import { createDeveloperMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { z } from 'zod'

// Identify the replaceable SQLite recall slot and older preview recall events.
// 标识可替换的 SQLite 召回位置及预览版的历史召回事件。
export const SQLITE_RECALL_SOURCE = 'vulcan-sqlite-memory'
export const SQLITE_RECALL_PROJECTION = 'vulcanSqliteRecall'
export const recallStateSchema = z.array(z.object({ seq: z.number(), text: z.string() }))
export type RecallState = z.infer<typeof recallStateSchema>

declare module '@deepseek-ai/dsh-llm' {
  // Mark SQLite recall contributions and their empty replacements.
  // 标记 SQLite 召回内容及其空白替换记录。
  interface MessageSourceMap {
    'vulcan-sqlite-memory': { kind: 'vulcan-sqlite-memory'; form: 'recall' }
  }
}

/** Fold durable SQLite recall events into the slot index, including sessions from the preview.
 *  将持久化的 SQLite 召回事件折叠为位置索引，兼容预览版已有的会话。 */
export function foldSqliteRecall(state: RecallState, event: SessionEvent): RecallState {
  if (event.type === 'compaction/summary' || event.type === 'compaction/prune') {
    const shadowed = new Set<number>(event.data.shadowedSeqs)
    return state.filter(slot => !shadowed.has(slot.seq))
  }
  let text: string
  if (event.type === 'user/message' && event.data.source.kind === SQLITE_RECALL_SOURCE) {
    const content = event.data.content[0]
    text = content?.type === 'text' ? content.text : ''
  } else if (event.type === 'developer/message' && event.data.message.source.kind === SQLITE_RECALL_SOURCE) {
    text = ''
  } else return state
  // Our replacement always shadows exactly one previous recall slot.
  // 我们的替换操作始终只隐藏一个已有召回位置。
  const operation = event.surfaceOp
  const replaced = operation === 'append' ? undefined : operation.startSeq
  return [...state.filter(slot => slot.seq !== replaced), { seq: event.seq, text }]
}

/** Remove refreshable memory from an auxiliary compaction request before it becomes summary text.
 *  在可刷新的记忆被写入摘要前，从辅助压缩请求中移除它。 */
export function filterSqliteRecallForCompaction(request: GenerateOptions<string>): void {
  // The DSH compactor constructs a mutable auxiliary request. Ordinary conversation requests
  // retain their frozen message list and the current recall.
  // DSH 压缩器构造可变的辅助请求。普通对话请求保留冻结的消息列表和当前召回。
  if (request.purpose !== 'compaction') return
  request.messages = request.messages.filter(message => !('source' in message) || message.source.kind !== SQLITE_RECALL_SOURCE)
}

/** Keep one current recall on the session surface. Return a message for normal admission only
 *  when the session has never had a recall slot. Empty text clears the previous recall.
 *  在会话可见上下文中保留一份当前召回。会话尚无召回位置时返回一条由主机正常接纳的消息，
 *  空文本表示清除上一份召回。 */
export function updateSqliteRecall(session: Session, state: RecallState, turn: number, step: number, text: string): UserMessage | undefined {
  // Use current surface membership because compaction may already have shadowed a recall.
  // 以当前可见节点为准，因为上下文压缩可能已隐藏某次召回。
  const known = new Map(state.map(slot => [slot.seq, slot.text]))
  const slots = known.size === 0 ? [] : session.surface.nodes.filter(seq => known.has(seq))
  const slot = slots.at(-1)
  const source = { kind: SQLITE_RECALL_SOURCE, form: 'recall' } as const
  if (slot === undefined) return text === '' ? undefined : createUserMessage({ source, content: [{ type: 'text', text }] })
  for (const seq of slots) {
    // Replace precisely one SQLite event. A range could hide user and assistant messages.
    // 每次只替换一条 SQLite 事件，防止连续区间误隐藏用户和模型的对话。
    const surfaceOp = { op: 'replace', startSeq: seq, endSeq: seq } as const
    if (seq === slot && text !== '') {
      if (known.get(seq) === text) continue
      session.append('user/message', createUserMessage({ source, content: [{ type: 'text', text }] }),
        { surfaceOp, sourceEventSeqs: [seq] })
    } else if (known.get(seq) !== '') {
      // An empty developer event shadows the old entry without rendering a prompt or changing the system prompt.
      // 空的 developer 事件隐藏旧条目，自身不进入请求，也不改变系统提示词。
      session.append('developer/message', { turn, step, message: createDeveloperMessage({ source, content: [] }) },
        { surfaceOp, sourceEventSeqs: [seq] })
    }
  }
}
