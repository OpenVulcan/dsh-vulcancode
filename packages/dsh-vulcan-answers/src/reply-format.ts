/**
 * The summary of the reader's `ui-decision` answers that the view puts into the composer; the
 * interactive guide describes this shape to the model.
 */

/** One answered decision. */
export interface DecisionReply {
  readonly question: string
  readonly picks: readonly string[]
  /** Option labels the answer recommended. */
  readonly recommended: readonly string[]
  readonly note: string
}

/** Interface-language words the summary uses. */
export interface ReplyLabels {
  readonly decisions: string
  readonly recommended: string
  readonly noChoice: string
}

/** Summarize decisions as Markdown: `question → picks`, a recommended pick labelled, notes quoted. */
export function formatDecisionReply(entries: readonly DecisionReply[], labels: ReplyLabels): string {
  if (entries.length === 0) return ''
  const quote = (note: string) => note.trim() ? note.trim().split(/\r?\n/u).map((line) => `  > ${line}`.trimEnd()) : []
  const lines = entries.flatMap((entry) => [
    `- ${entry.question} → ${entry.picks.length > 0
      ? entry.picks.map((pick) => entry.recommended.includes(pick) ? `${pick} (${labels.recommended})` : pick).join(', ')
      : labels.noChoice}`,
    ...quote(entry.note),
  ])
  return [`**${labels.decisions}**`, ...lines].join('\n')
}
