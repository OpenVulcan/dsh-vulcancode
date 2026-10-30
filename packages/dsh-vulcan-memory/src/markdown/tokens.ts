/**
 * Mixed-language token estimate, the same as VulcanCode's
 * `vulcan-context::estimate_mixed_language_text_tokens`: every ASCII run counts a quarter token per
 * character rounded up, CJK characters one token each, other characters two.
 */

export function estimateTokens(text: string): number {
  let asciiRun = 0
  let tokens = 0
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x80) {
      asciiRun += 1
      continue
    }
    if (asciiRun > 0) {
      tokens += Math.ceil(asciiRun / 4)
      asciiRun = 0
    }
    tokens += isCjkCharacter(code) ? 1 : 2
  }
  if (asciiRun > 0) tokens += Math.ceil(asciiRun / 4)
  return tokens
}

/** Whether a code point belongs to the common CJK text ranges. */
export function isCjkCharacter(code: number): boolean {
  return (code >= 0x3400 && code <= 0x4DBF)
    || (code >= 0x4E00 && code <= 0x9FFF)
    || (code >= 0xF900 && code <= 0xFAFF)
    || (code >= 0x3040 && code <= 0x30FF)
    || (code >= 0xAC00 && code <= 0xD7AF)
    || (code >= 0x20000 && code <= 0x2A6DF)
    || (code >= 0x2A700 && code <= 0x2B73F)
    || (code >= 0x2B740 && code <= 0x2B81F)
    || (code >= 0x2B820 && code <= 0x2CEAF)
    || (code >= 0x2CEB0 && code <= 0x2EBEF)
    || (code >= 0x30000 && code <= 0x3134F)
}
