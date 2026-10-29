/**
 * The one component the plugin mounts (in `shell.overlay`): it renders every mount the scanner
 * found into that mount's anchor through a portal, so components live in dsh's own React tree and
 * pick up its theme while the anchors sit next to the code blocks they replace.
 */

import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { useMemo, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import type { Translate } from './i18n'
import type { ReplyHub } from './reply'
import type { AnswerMount, AnswerScanner } from './scanner'
import { FenceView } from './views/component'
import type { ViewHost } from './views/frame'

export function AnswerOverlay({ hub, scanner, t }: { hub: ReplyHub; scanner: AnswerScanner; t: Translate }) {
  const mounts = useSyncExternalStore(scanner.subscribe, scanner.getSnapshot)
  return <>{mounts.map((mount) => createPortal(<MountView hub={hub} mount={mount} t={t} />, mount.anchor, String(mount.id)))}</>
}

function MountView({ hub, mount, t }: { hub: ReplyHub; mount: AnswerMount; t: Translate }) {
  const host = useMemo<ViewHost>(() => ({
    t,
    renderMarkdown: (body) => (
      <MarkdownText fileMentions={mount.markdown.fileMentions} labels={mount.markdown.labels} pathImages={mount.markdown.pathImages} text={body} />
    ),
  }), [mount, t])
  return (
    <FenceView anchor={mount.anchor} body={mount.body} component={mount.component} host={host} hub={hub}
      language={mount.language} meta={mount.meta} />
  )
}
