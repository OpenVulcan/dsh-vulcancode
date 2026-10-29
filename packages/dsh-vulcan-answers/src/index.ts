/**
 * Vulcan Answers for DeepSeek Harness: VulcanCode's interactive answer mode. While a session is
 * interactive the model receives the `ui-*` component guide as runtime context, and the browser half
 * renders the settled components in the chat. Each session keeps its own mode (see `session-state.ts`).
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'

import { answerContextText, loadAnswerModeTexts } from './prompt.js'
import { installSessionState, seedSession, type AnswerMode } from './session-state.js'

export { parseAnswerComponent, SUPPORTED_ANSWER_LANGUAGES, type AnswerComponent } from './answer-model.js'
export { MODE_COMMAND, MODE_RECORD, PROJECTION_KEY, type AnswerMode, type AnswerSessionView } from './session-state.js'

export const name = 'vulcan-answers'
export const inject = ['sessionProjections', 'systemPrompt']

/** Runtime context name; one per process. */
const CONTEXT_NAME = 'vulcan-answers:answer-mode'

/** After dsh's own runtime contexts (100-210), so the guide follows the facts it builds on. */
const CONTEXT_ORDER = 300

/** Every field is volatile: dsh's settings forms expose only volatile fields. */
export interface Config {
  /** Answer mode a new session starts with; existing sessions keep their own. */
  defaultMode: Volatile<AnswerMode>
}

export const Config = Schema.object({
  defaultMode: Schema.union(['interactive', 'standard'] as const)
    .default('interactive')
    .description('Answer mode new sessions start with. interactive: answers use ui-* components. standard: plain Markdown. Existing sessions keep their own mode.')
    .volatile(),
}) as unknown as Schema<Config>

/** The session an assembly is for; dsh-agent adds `agent` to the assemble context. */
function assembledSession(context: AssembleContext): Session | undefined {
  return (context as AssembleContext & { agent?: { session: Session } }).agent?.session
}

export function apply(ctx: Context, config: Config): void {
  const texts = loadAnswerModeTexts()
  const defaultMode = (): AnswerMode => config.defaultMode.get()
  const read = installSessionState(ctx, defaultMode)

  ctx.systemPrompt.context({
    name: CONTEXT_NAME,
    order: CONTEXT_ORDER,
    interpolate: false,
    // The mode is the user's choice for the session, so a persona that drops optional context keeps it.
    required: true,
    text: (context) => {
      const session = assembledSession(context)
      if (session === undefined) return ''
      const view = read(session)
      const fallback = defaultMode()
      try {
        seedSession(session, view, fallback)
      } catch (error) {
        ctx.logger.warn('could not record the default answer mode: %s', error)
      }
      return answerContextText(view, fallback, texts)
    },
  })
}
