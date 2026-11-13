import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { scrub } from './cloud.js'
import type { DerivedRecord, RecordEntry } from './store.js'

// Bound each turn and admit only text produced by a person or the model.
// 限制单轮大小，并且只采集用户或模型产生的文本。
const MAX_TEXT = 4_000
const MAX_CANDIDATES = 8

// Preserve the order of human and assistant text within one committed turn.
// 保留已提交回合内人类与模型文本的顺序。
export interface Dialogue {
  user: string
  timeline: { type: 'user' | 'assistant'; content: string }[]
  assistant: string
}

// Identify the exact event that completed the source dialogue.
// 标识完成来源对话的准确事件。
export interface CompletedTurn {
  id: string
  time: number
  dialogue: Dialogue
}

// Send only the two server-owned VMM stages for each operation.
// 每种操作只调用服务端提供的两级 VMM 推理。
type Infer = (purpose: 'pcl1' | 'pcl2' | 'ptl1' | 'ptl2', input: object) => Promise<unknown>
// Return ordered, visible records for one or more semantic queries.
// 为一条或多条语义查询返回有序的可见记录。
type Find = (queries: string[]) => Promise<RecordEntry[]>

/** Extract bounded text blocks without reading tool payloads, attachments or reasoning.
 *  提取有限长度的文本块，不读取工具载荷、附件或推理内容。 */
export function dialogueText(content: readonly ContentBlock[]): string {
  return scrub(content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')).slice(0, MAX_TEXT).trim()
}

/** Accumulate one turn from committed session events and return a completed, bounded dialogue.
 *  从已提交的会话事件积累单轮内容，返回完成且长度受限的对话。 */
export class TurnDialogue {
  // Bound the middle while always retaining the first human prompt and the last model answer.
  // 限制中间片段数量，同时保留首条人类提示与最后一条模型回答。
  private messages: Dialogue['timeline'] = []
  private user = ''
  private assistant = ''
  private turn: number | undefined

  /** Observe an event from this session. Return dialogue only after normal completion.
   *  观察当前会话的一条事件，仅在正常完成后返回对话。 */
  observe(event: SessionEvent): Dialogue | undefined {
    if (event.type === 'turn/start') {
      this.turn = event.data.turn
      this.messages = []
      this.user = ''
      this.assistant = ''
    } else if (this.turn !== undefined) {
      if (event.type === 'user/message' && event.data.source.kind === 'user' && event.surfaceOp === 'append') {
        const content = dialogueText(event.data.content)
        if (content !== '') {
          if (this.user === '') this.user = content
          else this.push('user', content)
          this.assistant = ''
        }
      } else if (event.type === 'assistant/message' && event.data.turn === this.turn && event.data.interrupted !== true) {
        const content = dialogueText(event.data.message.content)
        // Only a tool-free assistant message can be the final answer. Keep intermediate text in the timeline.
        // 只有不含工具调用的助手消息可作为最终回答，中间文本保留在时间线中。
        this.assistant = ''
        if (content !== '' && this.user !== '') {
          this.push('assistant', content)
          if (!event.data.message.content.some(block => block.type === 'tool-call')) this.assistant = content
        }
      } else if (event.type === 'turn/end' && event.data.turn === this.turn) {
        this.turn = undefined
        if (event.data.reason.kind === 'completed' && this.user !== '' && this.assistant !== '') {
          return { user: this.user, timeline: this.messages.slice(0, -1), assistant: this.assistant }
        }
      }
    }
    return undefined
  }

  /** Keep up to four recent middle messages with the final answer as a separate field.
   *  保留最近四条中间发言，最后回答单独保存。 */
  private push(type: Dialogue['timeline'][number]['type'], content: string): void {
    this.messages.push({ type, content })
    if (this.messages.length > 5) this.messages.shift()
  }
}

// Decode the free service's retrieval plan and reviewed candidate numbers.
// 解析免费服务的检索计划与审核后的候选编号。
const planSchema = z.object({
  reason: z.string().max(1_000), need_memory: z.boolean(),
  queries: z.array(z.string().trim().min(1).max(MAX_TEXT)).max(2),
})
const recallReview = z.object({ selected_candidate_numbers: z.array(z.number().int().positive()).max(MAX_CANDIDATES) })

/** Run VMM recall planning, local vector retrieval and the free relevance review.
 *  执行 VMM 召回规划、本机向量检索和免费相关性审核。 */
export async function precheck(text: string, recent: readonly CompletedTurn[], infer: Infer, find: Find,
  redact: (value: string) => string = scrub): Promise<RecordEntry[]> {
  const user = scrub(text).trim()
  if (user === '') return []
  const plan = planSchema.parse(await infer('pcl1', {
    current_user_input: user, current_context_hints: [], recent_context_hints: [], max_search_queries: 2,
    recent_turns: recent.map(turn => ({
      turn_id: turn.id, content_type: 'RAW_TURN',
      content: JSON.stringify({ user: redact(turn.dialogue.user).slice(0, 800), assistant: redact(turn.dialogue.assistant).slice(0, 800) }),
    })),
  }))
  if (!plan.need_memory) return []
  if (plan.queries.length === 0) throw new Error('OpenVulcan returned no recall query.')
  const records = (await find(plan.queries)).slice(0, MAX_CANDIDATES)
  if (records.length === 0) return []
  const review = recallReview.parse(await infer('pcl2', {
    current_datetime: new Date().toISOString(), user_content: user, search_queries: plan.queries.map(query => scrub(query)), intent_reason: scrub(plan.reason),
    candidates: records.map((record, index) => ({
      candidate_number: index + 1, memory_id: record.id, scope_level: record.scope,
      created_datetime: new Date(record.updated).toISOString(), abstract: scrub(record.title), details: scrub(record.body).slice(0, 1_500),
    })),
  }))
  if (review.selected_candidate_numbers.some(number => number > records.length)) throw new Error('OpenVulcan selected an unknown memory.')
  return [...new Set(review.selected_candidate_numbers)].slice(0, 6).map(number => records[number - 1]!)
}

// Validate the extraction and review envelopes before any local writes.
// 在本机写入前校验提取和审核的响应结构。
const evidence = z.object({
  evidence_source: z.enum(['user_asserted', 'user_confirmed', 'assistant_recalled_memory', 'assistant_recalled_profile',
    'assistant_general_knowledge', 'assistant_external_research', 'assistant_tool_discovered', 'mixed']),
  admission: z.enum(['keep', 'drop']), admission_reason: z.string().max(200),
})
const textSchema = z.string().trim().min(1).max(MAX_TEXT)
const extraction = z.object({
  turn_id: z.string(), user_input_kind: z.enum(['question', 'statement', 'mixed']),
  memory_nodes: z.array(evidence.extend({ category: z.number().int().min(0).max(7), abstract: textSchema, details: z.string().max(MAX_TEXT).nullish() })).max(64).nullish(),
  profile_nodes: z.array(evidence.extend({ profile_type: z.union([z.literal(0), z.literal(1)]), content: textSchema })).max(64).nullish(),
})
const index = z.number().int().nonnegative()
const ids = z.array(z.uuid()).max(24).nullish()
const memoryReview = z.object({
  accepted_candidates: z.array(z.object({ candidate_index: index, supersede_memory_ids: ids })).max(MAX_CANDIDATES).nullish(),
  dropped_candidates: z.array(z.object({ candidate_index: index, dedupe_memory_id: z.uuid().nullish() })).max(MAX_CANDIDATES).nullish(),
})
const profileReview = z.object({
  accepted_candidates: z.array(z.object({ candidate_index: index, normalized_content: textSchema, supersede_node_ids: ids,
    priority: z.enum(['P0', 'P1', 'P2']), level: z.enum(['L0', 'L1', 'L2', 'L3']) })).max(MAX_CANDIDATES).nullish(),
  invalid_candidate_indexes: z.array(index).max(MAX_CANDIDATES).nullish(), retire_only_node_ids: ids,
})

/** Check that each candidate was reviewed exactly once in its own block.
 *  检查每个候选在所属分区中恰好被审核一次。 */
function validateCoverage(numbers: number[], count: number): void {
  if (numbers.length !== count || new Set(numbers).size !== count || numbers.some(number => number >= count)) {
    throw new Error('OpenVulcan returned an invalid review candidate list.')
  }
}

/** Resolve only IDs from the exact records supplied to the corresponding review.
 *  仅解析对应审核中实际提供的记录标识。 */
function reviewedRecords(references: readonly string[] | null | undefined, records: readonly RecordEntry[]): RecordEntry[] {
  return (references ?? []).map(id => {
    const record = records.find(candidate => candidate.id === id)
    if (record === undefined) throw new Error('OpenVulcan referenced a record outside the reviewed scope.')
    return record
  })
}

/** Extract and review one completed turn using the published VMM PTL1 and PTL2 contracts.
 *  按已发布的 VMM PTL1 和 PTL2 契约提取并审核一个完成回合。 */
export async function postaction(turn: CompletedTurn, project: string, profiles: readonly RecordEntry[], infer: Infer, find: Find):
  Promise<{ changes: DerivedRecord[]; retire: RecordEntry[] }> {
  const datetime = new Date(turn.time).toISOString()
  const extracted = extraction.parse(await infer('ptl1', {
    current_time: { datetime }, reference_turns: [], recent_direct_memory_writes: [],
    target_turn: { turn_id: turn.id, created_datetime: datetime, raw_turn: turn.dialogue },
  }))
  if (extracted.turn_id !== turn.id) throw new Error('OpenVulcan returned a different turn identity.')
  const memories = (extracted.memory_nodes ?? []).filter(candidate => candidate.admission === 'keep').slice(0, 4)
  const user = (extracted.profile_nodes ?? []).filter(candidate => candidate.admission === 'keep' && candidate.profile_type === 0).slice(0, 4)
  const environment = project === '' ? [] : (extracted.profile_nodes ?? [])
    .filter(candidate => candidate.admission === 'keep' && candidate.profile_type === 1).slice(0, 4)
  if (memories.length + user.length + environment.length === 0) return { changes: [], retire: [] }

  // Keep replacement authority within the scope that owns the new record.
  // 将替换权限限定在新记录所属范围内。
  const memoryScope = project === '' ? 'user' : 'project'
  const similar: RecordEntry[][] = []
  for (const candidate of memories) {
    const matches = await find([scrub(candidate.abstract)])
    similar.push(matches.filter(record => record.scope === memoryScope).slice(0, 3))
  }
  const activeUser = profiles.filter(record => record.scope === 'user')
  const activeProject = profiles.filter(record => record.scope === 'project')
  const changes: DerivedRecord[] = []
  const retire: RecordEntry[] = []
  /** Serialize a profile review block with scope-local candidate indices.
   *  使用范围内的候选编号序列化画像审核分区。 */
  const profileBlock = (candidates: typeof user, active: RecordEntry[]) => ({
    latest_active_datetime: active[0] === undefined ? '' : new Date(active[0].updated).toISOString(),
    active_nodes: active.map(record => ({ id: record.id, datetime: new Date(record.updated).toISOString(), content: scrub(record.body).slice(0, 800) })),
    new_candidates: candidates.map((candidate, candidate_index) => ({
      candidate_index, turn_id: turn.id, datetime, content: scrub(candidate.content),
      evidence_source: candidate.evidence_source, admission_reason: candidate.admission_reason,
    })),
  })
  const result = z.object({ memory: memoryReview.nullish(), user: profileReview.nullish(), project: profileReview.nullish() })
    .parse(await infer('ptl2', {
      current_datetime: new Date().toISOString(), current_turn_datetime: datetime, user_input_kind: extracted.user_input_kind,
      user_content: turn.dialogue.user, assistant_content: turn.dialogue.assistant,
      ...(memories.length === 0 ? {} : { memory: memories.map((candidate, candidate_index) => ({
        candidate_index, candidate_datetime: datetime, category: candidate.category, abstract: scrub(candidate.abstract),
        details: scrub(candidate.details ?? candidate.abstract), evidence_source: candidate.evidence_source, admission_reason: candidate.admission_reason,
        similar_memories: similar[candidate_index]!.map(record => ({
          memory_id: record.id, scope_level: record.scope, created_datetime: new Date(record.updated).toISOString(),
          abstract: scrub(record.title), details: scrub(record.body).slice(0, 800),
        })),
      })) }),
      ...(user.length === 0 ? {} : { user: profileBlock(user, activeUser) }),
      ...(environment.length === 0 ? {} : { project: profileBlock(environment, activeProject) }),
    }))
  if ((result.memory != null) !== (memories.length > 0) || (result.user != null) !== (user.length > 0)
    || (result.project != null) !== (environment.length > 0)) throw new Error('OpenVulcan returned the wrong review blocks.')
  if (result.memory != null) {
    const { accepted_candidates, dropped_candidates } = result.memory
    validateCoverage([...(accepted_candidates ?? []), ...(dropped_candidates ?? [])].map(candidate => candidate.candidate_index), memories.length)
    for (const candidate of dropped_candidates ?? []) {
      if (candidate.dedupe_memory_id != null) reviewedRecords([candidate.dedupe_memory_id], similar[candidate.candidate_index]!)
    }
    for (const candidate of accepted_candidates ?? []) {
      const memory = memories[candidate.candidate_index]!
      changes.push({
        record: { kind: 'memory', scope: memoryScope, title: scrub(memory.abstract).slice(0, 160),
          body: scrub(memory.details?.trim() ? memory.details : memory.abstract) },
        supersedes: reviewedRecords(candidate.supersede_memory_ids, similar[candidate.candidate_index]!),
      })
    }
  }
  for (const [scope, review, candidates, active] of [
    ['user', result.user, user, activeUser], ['project', result.project, environment, activeProject],
  ] as const) {
    if (review == null) continue
    validateCoverage([...(review.accepted_candidates ?? []).map(candidate => candidate.candidate_index), ...(review.invalid_candidate_indexes ?? [])], candidates.length)
    for (const candidate of review.accepted_candidates ?? []) {
      const body = scrub(candidate.normalized_content)
      changes.push({ record: { kind: 'profile', scope, title: body.slice(0, 160), body },
        supersedes: reviewedRecords(candidate.supersede_node_ids, active) })
    }
    retire.push(...reviewedRecords(review.retire_only_node_ids, active))
  }
  return { changes, retire }
}
