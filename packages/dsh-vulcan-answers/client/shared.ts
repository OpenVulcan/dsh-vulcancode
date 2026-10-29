/**
 * Identifiers the browser half shares with the Host half. They mirror `src/session-state.ts` and
 * `src/index.ts`; the client does not import those files because they pull in Host-only packages.
 * `scripts/bundle-client.mjs` checks `PACKAGE_NAME` against package.json.
 */

/** Mirrors `AnswerMode` in `src/session-state.ts`. */
export type AnswerMode = 'standard' | 'interactive'

export const PACKAGE_NAME = '@openvulcan/dsh-vulcan-answers'

/** The plugin entry id whose configuration namespace holds `defaultMode`. */
export const ENTRY_ID = 'vulcan-answers'

/** Mirrors `PROJECTION_KEY` in `src/session-state.ts`. */
export const PROJECTION_KEY = 'vulcanAnswers'

/** Mirrors `MODE_COMMAND` in `src/session-state.ts`. */
export const MODE_COMMAND = 'vulcan-answer-mode'

/** Mirrors `AnswerSessionView` in `src/session-state.ts`. */
export interface AnswerSessionView {
  /** null: not yet seeded; the session follows the configured default. */
  readonly mode: AnswerMode | null
  readonly everInteractive: boolean
  readonly subagent: boolean
}

/** Mirrors the plugin's `Config`. */
export interface AnswerSettings {
  readonly defaultMode?: AnswerMode
}

/** Message text of any thrown value. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
