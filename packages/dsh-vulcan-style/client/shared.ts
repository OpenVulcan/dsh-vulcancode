/** Names and settings shapes shared by the controller, the settings row and the host schema. */

/** Must equal this package's name. */
export const PACKAGE_NAME = '@openvulcan/dsh-vulcan-style'
/** The Host entry id of this plugin's row in the suite patch, which names its configuration namespace. */
export const ENTRY_ID = 'vulcan-style'
/** The suite bundle whose patch declares this plugin's row; must equal that package's name. */
export const SUITE_PACKAGE = '@openvulcan/dsh-vulcancode'
/** The Plugins page's key for this row's configuration page: `<bundle package>#<row id>`. */
export const ROW_CONFIG_KEY = `${SUITE_PACKAGE}#${ENTRY_ID}`
/** Locale namespace of this plugin's interface text. */
export const NAMESPACE = 'vulcan-style'

/**
 * What the user chose; mirrors `THEME_CHOICES` in `src/index.ts`.
 *
 * - `vulcan-auto`: Vulcan light or dark, following the system colour scheme.
 * - `vulcan-light` / `vulcan-dark` / `vulcan-command`: that Vulcan theme.
 * - `dsh`: leave the theme to dsh's own Appearance setting.
 */
export const THEME_CHOICES = ['vulcan-auto', 'vulcan-light', 'vulcan-dark', 'vulcan-command', 'dsh'] as const
export type ThemeChoice = typeof THEME_CHOICES[number]

/** Configuration values as the Host's schema resolves them; mirrors `Config` in `src/index.ts`. */
export interface StyleSettings {
  readonly theme: ThemeChoice
  readonly squareCorners: boolean
}

/** Mirrors the defaults in `src/index.ts`. */
export const DEFAULT_SETTINGS: StyleSettings = { theme: 'vulcan-auto', squareCorners: true }

/** Whether a value is a known theme choice. */
export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value)
}

/** The accepted settings, falling back per field to the defaults while the Host has not answered. */
export function settingsOf(value: Partial<StyleSettings> | undefined): StyleSettings {
  return {
    theme: isThemeChoice(value?.theme) ? value.theme : DEFAULT_SETTINGS.theme,
    squareCorners: typeof value?.squareCorners === 'boolean' ? value.squareCorners : DEFAULT_SETTINGS.squareCorners,
  }
}
