/**
 * How the plugin's stored choice and dsh's live theme preference stay in step.
 *
 * dsh persists only its built-in preferences (`light`, `dark`, `system`), so a Vulcan theme is
 * re-applied from this plugin's own settings on every load. dsh also falls back to its stored
 * built-in preference by itself, for instance after any change to its own theme settings (a font
 * size) or when its settings arrive after this plugin applied a theme. Such a fallback is not the
 * user's choice, and the Vulcan theme is applied again. A preference the user picks with a pointer
 * or key press in dsh's own Appearance row is their choice and is recorded instead.
 */

import type { ThemeChoice } from './shared'
import { isVulcanTheme, type VulcanThemeId } from './themes'

/** dsh's built-in theme preferences. */
export const BUILTIN_PREFERENCES = ['light', 'dark', 'system'] as const

export function isBuiltinPreference(value: string): boolean {
  return (BUILTIN_PREFERENCES as readonly string[]).includes(value)
}

/** The Vulcan theme a choice asks for, or undefined when dsh's own setting decides. */
export function wantedTheme(choice: ThemeChoice, prefersDark: boolean): VulcanThemeId | undefined {
  if (choice === 'dsh') return undefined
  if (choice === 'vulcan-auto') return prefersDark ? 'vulcan-dark' : 'vulcan-light'
  return choice
}

/** What the plugin does after dsh's theme preference changed. */
export type Reaction =
  | { readonly kind: 'none' }
  /** Apply this Vulcan theme again. */
  | { readonly kind: 'apply'; readonly id: VulcanThemeId }
  /** Store this choice: the user picked it in dsh's own interface. */
  | { readonly kind: 'record'; readonly choice: ThemeChoice }

export interface PreferenceChange {
  /** The stored choice. */
  readonly choice: ThemeChoice
  readonly prefersDark: boolean
  /** dsh's new theme preference: a built-in preference or a registered theme id. */
  readonly preference: string
  /** Whether the change happened while a user input event was being handled. */
  readonly userInput: boolean
}

/** Decide how to answer a theme preference change this plugin did not make itself. */
export function reactToPreference({ choice, prefersDark, preference, userInput }: PreferenceChange): Reaction {
  const wanted = wantedTheme(choice, prefersDark)
  if (userInput) {
    if (isVulcanTheme(preference)) return preference === wanted ? { kind: 'none' } : { kind: 'record', choice: preference }
    // A built-in preference, or another plugin's theme: dsh's setting decides from now on.
    return choice === 'dsh' ? { kind: 'none' } : { kind: 'record', choice: 'dsh' }
  }
  if (wanted === undefined || preference === wanted) return { kind: 'none' }
  // dsh fell back to its stored preference, or a Vulcan theme no longer matches the system scheme.
  if (isBuiltinPreference(preference) || isVulcanTheme(preference)) return { kind: 'apply', id: wanted }
  // Another plugin applied its own theme without user input; leave it until the next load.
  return { kind: 'none' }
}

/** Event types that carry a user's deliberate choice. */
const USER_INPUT_EVENTS = new Set(['click', 'keydown', 'keyup', 'pointerup', 'mouseup', 'touchend', 'change', 'input', 'submit'])

/** Whether the event being dispatched right now is a trusted user input event. */
export function isUserInputEvent(event: { readonly type: string; readonly isTrusted: boolean } | undefined): boolean {
  return event !== undefined && event.isTrusted && USER_INPUT_EVENTS.has(event.type)
}
