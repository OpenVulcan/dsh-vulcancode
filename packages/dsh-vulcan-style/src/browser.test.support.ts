/**
 * Test access to the compiled browser half (`build/client`, CommonJS), whose sources sit outside
 * this project's root. The shapes are restated from `client/` for the tests only.
 */

import { readFileSync } from 'node:fs'

/**
 * The compiled files are CommonJS inside a `"type": "module"` package, so Node would read them as
 * ES modules; they are linked here the way `scripts/bundle-client.mjs` links them for dsh. The
 * modules loaded by tests require only each other.
 */
const cache = new Map<string, unknown>()
const client = <T>(file: string): T => {
  if (!cache.has(file)) {
    const module = { exports: {} as unknown }
    cache.set(file, module.exports)
    const source = readFileSync(new URL(`../build/client/${file}.js`, import.meta.url), 'utf8')
    const require = (request: string): unknown => {
      if (!request.startsWith('./')) throw new Error(`${file} requires ${request}, which tests cannot provide`)
      return client(request.slice(2))
    }
    new Function('module', 'exports', 'require', source)(module, module.exports, require)
    cache.set(file, module.exports)
  }
  return cache.get(file) as T
}

export interface ThemesModule {
  readonly VULCAN_THEME_IDS: readonly string[]
  readonly THEMES: readonly { readonly id: string; readonly colorScheme: 'light' | 'dark'; readonly tokens: Readonly<Record<string, string>> }[]
  readonly PALETTES: Readonly<Record<string, { readonly scheme: 'light' | 'dark' } & Readonly<Record<string, string>>>>
  isVulcanTheme(id: string): boolean
  squareCornerTokens(): Record<string, { light: string; dark: string }>
}

export interface TokensModule {
  readonly DSH_TOKENS_VERSION: string
  readonly SKIN_TOKENS: readonly string[]
  readonly RADIUS_TOKENS: readonly string[]
}

export type Reaction = { kind: 'none' } | { kind: 'apply'; id: string } | { kind: 'record'; choice: string }

export interface PolicyModule {
  readonly BUILTIN_PREFERENCES: readonly string[]
  wantedTheme(choice: string, prefersDark: boolean): string | undefined
  reactToPreference(change: { choice: string; prefersDark: boolean; preference: string; userInput: boolean }): Reaction
  isUserInputEvent(event: { type: string; isTrusted: boolean } | undefined): boolean
}

export interface SharedModule {
  readonly PACKAGE_NAME: string
  readonly SUITE_PACKAGE: string
  readonly ENTRY_ID: string
  readonly ROW_CONFIG_KEY: string
  readonly THEME_CHOICES: readonly string[]
  readonly DEFAULT_SETTINGS: { readonly theme: string; readonly squareCorners: boolean }
  settingsOf(value: unknown): { readonly theme: string; readonly squareCorners: boolean }
}

export interface I18nModule {
  readonly zh: Readonly<Record<string, string>>
  readonly en: Readonly<Record<string, string>>
}

export const themes = (): ThemesModule => client('themes')
export const tokens = (): TokensModule => client('dsh-tokens')
export const policy = (): PolicyModule => client('policy')
export const shared = (): SharedModule => client('shared')
export const i18n = (): I18nModule => client('i18n')
