/**
 * Keeps dsh's live theme in step with this plugin's settings: registers the Vulcan themes, applies
 * the stored choice when the settings arrive and whenever they change, answers dsh's own preference
 * changes (`policy.ts`), and stacks the square-corner layer. Also marks the document root while a
 * Vulcan theme or square corners are active, which is what `style.ts` scopes its rules to.
 */

import type { ClientContext, ConfigForm } from './dsh-client'
import { isBuiltinPreference, isUserInputEvent, reactToPreference, wantedTheme } from './policy'
import { PACKAGE_NAME, settingsOf, type StyleSettings, type ThemeChoice } from './shared'
import { isVulcanTheme, squareCornerTokens, THEMES } from './themes'

/** dsh's own theme settings namespace (`THEME_SETTINGS_NAMESPACE` in dsh-client-ui-theme). */
export const DSH_THEME_SETTINGS = 'ui-theme'

/** Root attribute naming the active Vulcan theme (`light`, `dark` or `command`). */
export const THEME_ATTRIBUTE = 'data-vulcan-theme'
/** Root attribute present while the square-corner layer is stacked. */
export const SQUARE_ATTRIBUTE = 'data-vulcan-square'

/** The parts of dsh's theme settings read here. */
interface DshThemeSettings {
  readonly preference?: string
}

const log = (message: string, error?: unknown): void => {
  console.warn(`[${PACKAGE_NAME}] ${message}`, ...error === undefined ? [] : [error])
}

/** Writes of this plugin's settings, for the settings row. */
export interface SettingsWriter {
  /** @returns true when the Host accepted the change. */
  write(change: Partial<StyleSettings>): Promise<boolean>
}

export function settingsWriter(form: ConfigForm<StyleSettings>): SettingsWriter {
  return {
    write: change => form.mutate(Object.entries(change).map(([key, value]) => ({ op: 'set', path: [key], value }))),
  }
}

/** Register the themes and keep the preference in step; returns the disposer. */
export function installThemeSync(ctx: ClientContext, form: ConfigForm<StyleSettings>): () => void {
  const theme = ctx.theme
  const dshSettings = ctx.configForms.get<DshThemeSettings>(DSH_THEME_SETTINGS)
  const media = matchMedia('(prefers-color-scheme: dark)')
  const root = document.documentElement
  let own = 0
  let live = true

  /** Settings arrived (or are unavailable, in which case the defaults apply). */
  const settled = (): boolean => form.getSnapshot().status !== 'loading'
  const settings = (): StyleSettings => settingsOf(form.getSnapshot().value)
  /** The built-in preference dsh stores, which a Vulcan theme only covers while it is active. */
  const storedBuiltin = (): string => {
    const preference = dshSettings.getSnapshot().value?.preference
    return typeof preference === 'string' && isBuiltinPreference(preference) ? preference : 'system'
  }

  /** Switch dsh's preference without treating the resulting change as someone else's. */
  const set = (id: string): void => {
    if (theme.getTheme().preference === id) return
    own += 1
    try {
      theme.setTheme(id)
    } catch (error) {
      log(`cannot switch the theme to ${id}`, error)
    } finally {
      own -= 1
    }
  }

  const markTheme = (activeId: string): void => {
    if (isVulcanTheme(activeId)) root.setAttribute(THEME_ATTRIBUTE, activeId.slice('vulcan-'.length))
    else root.removeAttribute(THEME_ATTRIBUTE)
  }

  /** Bring the live preference to the stored choice. */
  const applyChoice = (): void => {
    if (!live || !settled()) return
    const wanted = wantedTheme(settings().theme, media.matches)
    if (wanted !== undefined) set(wanted)
    else if (isVulcanTheme(theme.getTheme().preference)) set(storedBuiltin())
  }

  const record = (choice: ThemeChoice): void => {
    const snapshot = form.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable) {
      log(`cannot record the theme choice "${choice}": the plugin settings are not writable`)
      return
    }
    form.mutate([{ op: 'set', path: ['theme'], value: choice }]).then(
      accepted => { if (!accepted) log(`the Host refused the theme choice "${choice}"`) },
      (error: unknown) => { log(`cannot record the theme choice "${choice}"`, error) },
    )
  }

  const registrations = THEMES.map(definition => theme.register(definition))
  markTheme(theme.getTheme().active.id)

  const stopChange = ctx.on('theme/change', snapshot => {
    markTheme(snapshot.active.id)
    if (own > 0 || !live || !settled()) return
    const reaction = reactToPreference({
      choice: settings().theme,
      prefersDark: media.matches,
      preference: snapshot.preference,
      // dsh emits synchronously from setTheme, so a pick in its Appearance row arrives while the
      // click is still being dispatched; its own fallbacks arrive from settings callbacks.
      userInput: isUserInputEvent(window.event),
    })
    if (reaction.kind === 'record') record(reaction.choice)
    // Out of the emit, so every listener of this change sees it before the next one starts.
    else if (reaction.kind === 'apply') queueMicrotask(applyChoice)
  })

  let squareLayer: (() => void) | undefined
  const applyCorners = (): void => {
    const wanted = live && settings().squareCorners
    if (wanted && squareLayer === undefined) {
      squareLayer = theme.overrideTokens(PACKAGE_NAME, squareCornerTokens())
      root.setAttribute(SQUARE_ATTRIBUTE, '')
    } else if (!wanted && squareLayer !== undefined) {
      squareLayer()
      squareLayer = undefined
      root.removeAttribute(SQUARE_ATTRIBUTE)
    }
  }

  const onSettings = (): void => {
    applyChoice()
    if (settled()) applyCorners()
  }
  const stopSettings = form.subscribe(onSettings)
  const onScheme = (): void => { if (settings().theme === 'vulcan-auto') applyChoice() }
  media.addEventListener('change', onScheme)
  onSettings()

  return () => {
    live = false
    stopChange()
    stopSettings()
    media.removeEventListener('change', onScheme)
    applyCorners()
    // Hand the page back to the user's built-in preference rather than dsh's default.
    if (isVulcanTheme(theme.getTheme().preference)) set(storedBuiltin())
    for (const unregister of registrations) unregister()
    root.removeAttribute(THEME_ATTRIBUTE)
  }
}
