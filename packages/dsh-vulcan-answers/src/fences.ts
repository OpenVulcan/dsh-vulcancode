/**
 * Recover a fence's info string from the Markdown source. dsh's code block receives only the first
 * word of the info string as its language, while `ui-*` components also read the rest (`ui-chart bar
 * Weekly`), so the browser half looks the fence up in the message text it rendered from.
 */

/** One fenced block found in Markdown source. */
export interface SourceFence {
  /** First word of the info string, as Markdown parsers report the language. */
  readonly language: string
  /** The rest of the info string, trimmed. */
  readonly meta: string
  /** The fence content without its fences and without the opening line's indentation. */
  readonly body: string
}

/** Container prefix (`>` quotes) and indentation before a fence marker. */
const OPENING = /^((?:[ \t]*>)*)([ \t]*)(`{3,}|~{3,})(.*)$/u

/**
 * Every fenced block of `markdown`, outer fences before the fences nested in their content. The scan is
 * deliberately lenient (list and quote containers are only stripped, not modelled): it serves to look
 * up a fence whose language and content the renderer already reported, never to decide what is a fence.
 */
export function scanFences(markdown: string): SourceFence[] {
  const lines = markdown.split(/\r?\n/u)
  const found: SourceFence[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const opening = OPENING.exec(lines[index] ?? '')
    if (!opening) continue
    const quotes = opening[1] ?? ''
    const indent = (opening[2] ?? '').length
    const marker = opening[3] ?? ''
    const info = (opening[4] ?? '').trim()
    if (marker.startsWith('`') && info.includes('`')) continue
    const char = marker[0] ?? '`'
    const closing = new RegExp(`^(?:[ \\t]*>)*[ \\t]*${char}{${marker.length},}[ \\t]*$`, 'u')
    const body: string[] = []
    let end = index + 1
    for (; end < lines.length; end += 1) {
      const line = lines[end] ?? ''
      if (closing.test(line)) break
      body.push(stripPrefix(line, quotes.length > 0, indent))
    }
    const [word = ''] = info.split(/\s/u)
    found.push({ language: word, meta: info.slice(word.length).trim(), body: body.join('\n') })
    const nested = scanFences(body.join('\n'))
    found.push(...nested)
    index = end
  }
  return found
}

/** Remove a quote prefix and up to `indent` columns of indentation from one content line. */
function stripPrefix(line: string, quoted: boolean, indent: number): string {
  let text = quoted ? line.replace(/^(?:[ \t]*>[ ]?)+/u, '') : line
  let removed = 0
  while (removed < indent && (text.startsWith(' ') || text.startsWith('\t'))) {
    text = text.slice(1)
    removed += 1
  }
  return text
}

/**
 * The meta of the fence in `markdown` whose language starts with `language` (as dsh reports it, the
 * leading `[\w-]+` run) and whose content is `code`. An exact content match wins over one that only
 * matches line by line after trimming; undefined when no fence matches.
 */
export function findFenceInfo(markdown: string, language: string, code: string): { language: string; meta: string } | undefined {
  const target = code.replace(/\n$/u, '')
  const candidates = scanFences(markdown).filter((fence) => /^[\w-]+/u.exec(fence.language)?.[0] === language)
  const exact = candidates.find((fence) => fence.body === target)
  const loose = exact ?? candidates.find((fence) => sameTrimmedLines(fence.body, target))
  return loose === undefined ? undefined : { language: loose.language, meta: loose.meta }
}

/** Whether two texts have the same nonblank lines after trimming each. */
function sameTrimmedLines(a: string, b: string): boolean {
  const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')
  return lines(a) === lines(b)
}
