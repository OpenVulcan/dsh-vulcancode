/**
 * The memory snapshot a conversation sees. VulcanCode locks it into the system-prompt baseline;
 * dsh's equivalent is one durable, source-attributed user message: appended before the first step
 * of a session, and again only after a compaction shadowed it. Writes made in between are not
 * shown (the model reads current text with `memory_search`), so the prompt cache stays intact.
 */

import { z } from 'zod'

import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-session-projection'

export const SOURCE_KIND = 'vulcan-memory'
export const PROJECTION_KEY = 'vulcanMemory'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'vulcan-memory': { kind: 'vulcan-memory' } & ContextFormed
  }
}

export const injectionStateSchema = z.object({
  /** Seq of the snapshot message the model currently sees, or null when none is visible. */
  injectedSeq: z.number().nullable(),
  /** Whether a compaction shadowed an earlier snapshot. */
  compacted: z.boolean(),
})

export type InjectionState = z.infer<typeof injectionStateSchema>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Whether this session's model currently sees a memory snapshot. */
    vulcanMemory: InjectionState
  }
}

export const INITIAL_STATE: InjectionState = { injectedSeq: null, compacted: false }

/** Fold one session event into the injection state. */
export function applyEvent(state: InjectionState, event: SessionEvent): InjectionState {
  if (event.type === 'user/message') {
    return event.data.source.kind === SOURCE_KIND ? { ...state, injectedSeq: event.seq } : state
  }
  if (event.type === 'compaction/summary' || event.type === 'compaction/prune') {
    const injected = state.injectedSeq
    if (injected !== null && event.data.shadowedSeqs.some(seq => seq === injected)) return { injectedSeq: null, compacted: true }
  }
  return state
}

/** Subagents never see or write long-term memory, as in VulcanCode. */
export function isSubagent(header: SessionHeader): boolean {
  return header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0
}

const DESCRIPTION = 'Long-term memory captured when this conversation started or was last compacted. Changes written since then are not shown here; use memory_search for the current text.'

/** The snapshot message text: VulcanCode's `long_term_memory` block, guide first. */
export function renderMemoryBlock(guide: string, snapshot: string, compacted: boolean): string {
  const memory = snapshot.trim() === '' ? 'Memory is empty so far.' : snapshot
  return [
    '<long_term_memory>',
    DESCRIPTION,
    `Phase: ${compacted ? 'after_context_compaction' : 'first_session'}`,
    'Source: Markdown memory',
    '',
    `${guide.trim()}\n\n${memory}`,
    '</long_term_memory>',
  ].join('\n')
}
