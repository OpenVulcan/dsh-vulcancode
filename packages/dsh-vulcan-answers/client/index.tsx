/**
 * Browser half of the plugin:
 *
 * - The scanner finds settled `ui-*` code blocks in assistant messages and hides each one behind an
 *   anchor (`scanner.ts`).
 * - One overlay component in `shell.overlay` portals the rendered components into those anchors
 *   (`overlay.tsx`, `views/`).
 * - The composer pill switches the session's answer mode and registers its composer for
 *   `ui-decision` replies (`quick.tsx`, `reply.ts`).
 *
 * dsh loads this bundle as one lazy factory; outside it, only modules dsh serves to plugins are used.
 */

import type { ClientContext } from './dsh-client'
import { en, NAMESPACE, zh, type Translate } from './i18n'
import { AnswerOverlay } from './overlay'
import { ModePill, type QuickInjected } from './quick'
import { ReplyHub } from './reply'
import { AnswerScanner } from './scanner'
import { ENTRY_ID, MODE_COMMAND, type AnswerSettings } from './shared'
import { installStyle } from './style'

export const inject = ['slots', 'locale', 'sessions', 'configForms']

export function apply(ctx: ClientContext): void {
  const scanner = new AnswerScanner()
  const hub = new ReplyHub()
  const form = ctx.configForms.get<AnswerSettings>(ENTRY_ID)

  ctx.effect(() => installStyle(), 'vulcan-answers: stylesheet')
  ctx.effect(() => ctx.locale.register(NAMESPACE, { zh, en }), 'vulcan-answers: dictionaries')
  ctx.effect(() => scanner.start(), 'vulcan-answers: code block scanner')

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'vulcan-answers-overlay',
    locale: NAMESPACE,
  }, ({ t }) => <AnswerOverlay hub={hub} scanner={scanner} t={t as Translate} />))

  // Next to the other composer pills; the decision guard uses 10.
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'vulcan-answers-mode',
    order: 12,
    locale: NAMESPACE,
    inject: (sessionId: string): QuickInjected => ({
      hub,
      form,
      materialized: () => ctx.sessions.binding(sessionId) !== undefined,
      setMode: async (mode) => {
        const session = ctx.sessions.binding(sessionId)?.session
        if (session === undefined) throw new Error('this session is not materialized yet')
        const result = await session.command(`/${MODE_COMMAND} ${mode}`)
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
        if (!result.value.matched) throw new Error(`the Host offers no /${MODE_COMMAND} command`)
      },
    }),
  }, ModePill))
}
