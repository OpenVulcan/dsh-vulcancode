import { createDeveloperMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { SOURCE_KIND } from './inject.js'
import { TOOL_SPECS } from './markdown/index.js'
import { SQLITE_RECALL_SOURCE } from './sqlite/recall.js'
import type { MemoryMode } from './settings.js'

// Keep the original tool names here solely to recognize historical tool results.
// 此处保留原工具名，仅用于识别历史工具结果。
export const VMM_SEARCH = 'vmm_memory_search'
export const VMM_WRITE = 'vmm_memory_write'
// Use the registered Markdown names to recognize their recorded results.
// 使用 Markdown 工具的注册名识别其历史结果。
const markdownNames = new Set<string>(Object.values(TOOL_SPECS).map(spec => spec.name))
const vmmNames = new Set([VMM_SEARCH, VMM_WRITE, 'sqlite_memory_search', 'sqlite_memory_write'])
const inactiveResult = '[Long-term memory result omitted because its mode is inactive.]'

// Keep call ownership and live result positions in a replayable host projection.
// 通过可重放的宿主投影记录调用归属及可见结果位置。
export const MODE_CONTEXT_PROJECTION = 'vulcanMemoryModeContext'
const sourceMode = z.enum(['markdown', 'sqlite'])
export const modeContextSchema = z.object({
  calls: z.array(z.object({ id: z.string(), mode: sourceMode })),
  entries: z.array(z.object({ seq: z.number(), mode: sourceMode })),
})
export type ModeContext = z.infer<typeof modeContextSchema>
export const INITIAL_MODE_CONTEXT: ModeContext = { calls: [], entries: [] }

/** Resolve the backend from a recorded tool name.
 *  根据已记录的工具名解析所属记忆后端。 */
function toolMode(name: string): z.infer<typeof sourceMode> | undefined {
  if (markdownNames.has(name)) return 'markdown'
  if (vmmNames.has(name)) return 'sqlite'
}

/** Identify the plugin's bundled curator from DSH's structured skill rendering.
 *  从 DSH 的技能渲染结构识别本插件随附的整理技能。 */
function isCurator(message: {
  readonly role: string
  readonly source?: { readonly kind: string }
  readonly content: readonly ContentBlock[]
}): boolean {
  if (message.role !== 'tool' && message.source?.kind !== 'skill-invocation') return false
  const block = message.content[0]
  return block?.type === 'text' && block.text.startsWith('<skill_content name="memory-curator">\n<skill_resources>\nResources for this skill are managed by provider "vulcan-memory".\n')
}

/** Fold owned memory context while retaining ordinary user and assistant history.
 *  折叠插件拥有的记忆上下文，同时保留普通用户及助手历史。 */
export function foldModeContext(state: ModeContext, event: SessionEvent): ModeContext {
  if (event.type === 'turn/end') return state.calls.length === 0 ? state : { ...state, calls: [] }
  if (event.type === 'tool/call') {
    const mode = toolMode(event.data.name)
    return mode === undefined ? state : { ...state, calls: [...state.calls, { id: event.data.callId, mode }] }
  }
  if (event.type === 'compaction/summary' || event.type === 'compaction/prune') {
    const shadowed = new Set<number>(event.data.shadowedSeqs)
    return { ...state, entries: state.entries.filter(entry => !shadowed.has(entry.seq)) }
  }
  if (event.type !== 'user/message' && event.type !== 'tool/result' && event.type !== 'developer/message') return state
  const replaced = event.surfaceOp === 'append' ? undefined : event.surfaceOp.startSeq
  const entries = replaced === undefined ? state.entries : state.entries.filter(entry => entry.seq !== replaced)
  if (event.type === 'developer/message') return entries.length === state.entries.length ? state : { ...state, entries }
  const message = event.type === 'tool/result' ? event.data.message : event.data
  const mode = message.role === 'tool' ? state.calls.find(call => call.id === message.toolCallId)?.mode : undefined
  if (message.content[0]?.type === 'text' && message.content[0].text === inactiveResult) return { ...state, entries }
  const owner = mode ?? (message.source.kind === SOURCE_KIND || isCurator(message) ? 'markdown' : undefined)
    ?? (event.type === 'tool/result' ? state.entries.find(entry => entry.seq === replaced)?.mode : undefined)
  if (owner !== undefined) return { ...state, entries: [...entries, { seq: event.seq, mode: owner }] }
  return entries === state.entries ? state : { ...state, entries }
}

/** Withdraw inactive memory payloads while preserving tool call/result pairing and the original log.
 *  撤下未启用模式的记忆载荷，同时保留工具调用与结果配对及原始日志。 */
export function clearInactiveMemory(session: Session, state: ModeContext, mode: MemoryMode, turn: number, step: number): void {
  const visible = new Set<number>(session.surface.nodes)
  for (const entry of state.entries) {
    if (entry.mode === mode || !visible.has(entry.seq)) continue
    const seq = entry.seq as SessionSeq
    // Use the exact node identified by the projection to retain the host's tool result metadata.
    // 使用投影识别的确切节点，以保留宿主的工具结果元数据。
    const original = session.eventAt(seq)
    const placement = { surfaceOp: { op: 'replace' as const, startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] }
    if (original?.type === 'tool/result') {
      session.append('tool/result', { ...original.data, message: {
        ...original.data.message, content: [{ type: 'text', text: inactiveResult }],
      } }, placement)
    } else if (original?.type === 'user/message') {
      session.append('developer/message', { turn, step, message: createDeveloperMessage({
        source: { kind: SOURCE_KIND, form: 'snapshot', sections: [] }, content: [],
      }) }, placement)
    }
  }
}

/** Exclude both memory sources from new compaction summaries, keeping tool pairs intact.
 *  从新压缩摘要中排除两种记忆来源，同时保留工具调用配对。 */
export function filterMemoryForCompaction(request: GenerateOptions<string>): void {
  if (request.purpose !== 'compaction') return
  const memoryCalls = new Set(request.messages.flatMap(message => message.content.flatMap(block =>
    block.type === 'tool-call' && toolMode(block.name) !== undefined ? [block.id] : [])))
  request.messages = request.messages.flatMap(message => {
    if (!('source' in message)) return [message]
    if (message.source.kind === SOURCE_KIND || message.source.kind === SQLITE_RECALL_SOURCE) return []
    if (message.role === 'tool' && (memoryCalls.has(message.toolCallId) || isCurator(message))) {
      return [{ ...message, content: [{ type: 'text', text: inactiveResult }] }]
    }
    if (message.role === 'user' && isCurator(message)) return []
    return [message]
  })
}
