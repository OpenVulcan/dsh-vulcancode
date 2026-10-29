/**
 * Per-session answer mode. The mode lives in the session's own log as plugin records, so it follows
 * the session through restarts, forks and resumes; a session projection folds it and serves it to the
 * composer pill, and one slash command is the only user write path. The plugin's configured default
 * only seeds a session that has no record yet, at its first prompt assembly; subagent sessions are
 * always standard and never get a record.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import { appendPluginRecord, pluginRecordOf, type Session, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

/** How the model answers in one session. */
export type AnswerMode = 'standard' | 'interactive'

/** Package name, the command definition id. */
export const PACKAGE_NAME = '@openvulcan/dsh-vulcan-answers'

/** Record type of one mode switch. */
export const MODE_RECORD = 'plugin:vulcan-answers/mode'

/** Projection key the client reads; also restated in `client/shared.ts`. */
export const PROJECTION_KEY = 'vulcanAnswers'

/** Slash command that switches the mode; also restated in `client/shared.ts`. */
export const MODE_COMMAND = 'vulcan-answer-mode'

/** One mode switch, as logged. */
export interface ModeRecord {
  readonly mode: AnswerMode
}

/** What the session projection holds and serves. */
export interface AnswerSessionView {
  /** The recorded mode; null until the session is seeded or switched. */
  readonly mode: AnswerMode | null
  /** Whether any record ever set interactive, so a later standard mode needs the stop note. */
  readonly everInteractive: boolean
  /** A subagent session, which always answers in standard mode. */
  readonly subagent: boolean
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** The session's answer mode; the latest record wins. */
    'plugin:vulcan-answers/mode': ModeRecord
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    vulcanAnswers: AnswerSessionView
  }
  interface SessionProjectionMap {
    /** Vulcan Answers' per-session mode for the composer pill. */
    vulcanAnswers: AnswerSessionView
  }
}

/** Whether a value is an answer mode. */
export function isAnswerMode(value: unknown): value is AnswerMode {
  return value === 'standard' || value === 'interactive'
}

/** Whether a session header describes a subagent child. */
export function isSubagentHeader(header: Pick<SessionHeader, 'origin' | 'delegationDepth'>): boolean {
  return header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0
}

/** The state a session starts from. */
export function initialView(header: Pick<SessionHeader, 'origin' | 'delegationDepth'>): AnswerSessionView {
  return Object.freeze({ mode: null, everInteractive: false, subagent: isSubagentHeader(header) })
}

/** The mode a session answers in now: subagents are standard, an unseeded session follows the default. */
export function effectiveMode(view: AnswerSessionView, defaultMode: AnswerMode): AnswerMode {
  return view.subagent ? 'standard' : view.mode ?? defaultMode
}

/**
 * Validator of the state and the wire view. dsh only calls `parse`; a hand-written one keeps this
 * package off dsh's zod version, whose schema type the definition names.
 */
const viewSchema = {
  parse(value: unknown): AnswerSessionView {
    const view = value as Partial<AnswerSessionView> | null
    if (
      typeof view === 'object' && view !== null && (view.mode === null || isAnswerMode(view.mode))
      && typeof view.everInteractive === 'boolean' && typeof view.subagent === 'boolean'
    ) {
      return Object.freeze({ mode: view.mode, everInteractive: view.everInteractive, subagent: view.subagent })
    }
    throw new TypeError('vulcanAnswers projection: expected { mode: "standard" | "interactive" | null, everInteractive: boolean, subagent: boolean }')
  },
} as unknown as ProjectionDefinition<'vulcanAnswers'>['stateSchema']

/**
 * Fold one event into the state. Records are validated because a restored record carries whatever an
 * earlier build wrote; one that does not parse leaves the state unchanged.
 */
export function applySessionRecord(state: AnswerSessionView, event: SessionEvent): AnswerSessionView {
  const record = pluginRecordOf(event)
  if (record === undefined || record.type !== MODE_RECORD) return state
  const data = record.data as Record<string, unknown> | null
  if (typeof data !== 'object' || data === null) return state
  const mode = data['mode']
  if (!isAnswerMode(mode)) return state
  const everInteractive = state.everInteractive || mode === 'interactive'
  return mode === state.mode && everInteractive === state.everInteractive ? state : Object.freeze({ ...state, mode, everInteractive })
}

/** Reader of a session's mode state. */
export type ReadAnswerState = (session: Session) => AnswerSessionView

/** Register the projection and the command; returns the state reader. */
export function installSessionState(ctx: Context, defaultMode: () => AnswerMode): ReadAnswerState {
  const projections = ctx.sessionProjections
  projections.register<'vulcanAnswers', AnswerSessionView>({
    key: PROJECTION_KEY,
    stateVersion: 1,
    stateSchema: viewSchema,
    init: header => initialView(header),
    apply: applySessionRecord,
    wire: { viewSchema, view: state => state },
  })
  const read: ReadAnswerState = session => projections.stateOf(session, PROJECTION_KEY) ?? initialView(session.header)

  ctx.inject(['commands'], (child) => {
    child.commands.register({
      definitionId: CommandDefinitionId(PACKAGE_NAME),
      name: MODE_COMMAND,
      description: 'Switch this session\'s answer mode between interactive ui-* components and standard Markdown, from the next request',
      input: { hint: 'interactive | standard' },
      handler: ({ agent, rawInput }) => {
        const word = rawInput.trim().toLowerCase()
        const view = read(agent.session)
        if (word === '') return { kind: 'success', text: `answer mode ${effectiveMode(view, defaultMode())}` }
        if (!isAnswerMode(word)) return { kind: 'error', text: `expected "interactive" or "standard", got "${word}"` }
        if (view.subagent) return { kind: 'error', text: 'subagent sessions always answer in standard mode' }
        if (view.mode !== word) appendPluginRecord(agent.session, MODE_RECORD, { mode: word })
        return { kind: 'success', text: `answer mode ${word} from the next request` }
      },
    })
  })

  return read
}

/**
 * Give an unseeded top-level session the configured default as its own record, so a later change of
 * the default does not move it. Called while its prompt is assembled.
 */
export function seedSession(session: Session, view: AnswerSessionView, defaultMode: AnswerMode): void {
  if (view.subagent || view.mode !== null) return
  appendPluginRecord(session, MODE_RECORD, { mode: defaultMode })
}
