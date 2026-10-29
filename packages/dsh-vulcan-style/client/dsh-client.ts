/**
 * The parts of dsh's browser runtime this client half uses.
 *
 * dsh serves these modules from its page module table; their packages are not published at the
 * Host's version, so the shapes are restated here from dsh 0.2.1-rc.2 and must be checked again when
 * the supported dsh range moves:
 * - `@deepseek-ai/dsh-client-ui-theme` `lib/types/client/index.d.ts` (`ThemeRuntime`, `ThemeSnapshot`,
 *   `theme/change`)
 * - `packages/client/ui-settings/src/client/config-form-types.ts` (`ConfigForm`)
 * - `packages/client/ui-settings/src/client/contract/slots.ts` (`settings.general.item`)
 * - `packages/client/locale/src/client/index.ts` (`register`)
 */

/** One field write of a configuration namespace; `value` is JSON. */
export type ConfigOp =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }

/** Accepted Host values of one configuration namespace. */
export interface ConfigFormSnapshot<T> {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value: T | undefined
  readonly revision: number | undefined
  readonly writable: boolean
}

/** Reads and writes of one plugin entry's configuration namespace. */
export interface ConfigForm<T> {
  getSnapshot(): ConfigFormSnapshot<T>
  subscribe(listener: () => void): () => void
  /** @returns true when the Host accepted every operation. */
  mutate(ops: readonly ConfigOp[], expectedRevision?: number): Promise<boolean>
}

/** A theme as dsh's registry takes it. */
export interface ThemeDefinitionFace {
  readonly id: string
  readonly colorScheme: 'light' | 'dark'
  readonly tokens: Readonly<Record<string, string>>
}

/** Immutable theme state; only the fields read here. */
export interface ThemeSnapshot {
  /** The live preference: a built-in preference (`light`, `dark`, `system`) or a registered theme id. */
  readonly preference: string
  readonly active: ThemeDefinitionFace
  readonly revision: number
}

/** dsh's theme service (`ctx.theme`). */
export interface ThemeRuntime {
  getTheme(): ThemeSnapshot
  /** Switch the live preference; only built-in preferences are persisted by dsh. Unknown ids throw. */
  setTheme(id: string): void
  /** @returns disposer; disposing the theme behind the active preference resets it to dsh's default. */
  register(definition: ThemeDefinitionFace): () => void
  /** Stack a token layer over whatever theme is active; @returns its disposer. */
  overrideTokens(source: string, tokens: Readonly<Record<string, { readonly light: string; readonly dark: string }>>): () => void
}

/** Props of a General settings row, plus the dictionary of its locale namespace. */
export interface GeneralItemProps {
  readonly t: (key: string) => string
}

/**
 * Props of a `plugins.row.config` entry (ui-plugin-manager `PluginConfigViewProps`), plus the dictionary of its
 * locale namespace: `summary` asks for the one-liner, `page` for the form.
 */
export interface RowConfigProps {
  readonly view: 'summary' | 'page'
  readonly t: (key: string) => string
}

/** The browser plugin context services this client half injects. */
export interface ClientContext {
  effect(execute: () => () => void, label?: string): void
  on(name: 'theme/change', listener: (snapshot: ThemeSnapshot) => void): () => void
  readonly theme: ThemeRuntime
  readonly locale: {
    register(namespace: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>): () => void
  }
  readonly slots: {
    inject(name: string, callback: () => () => void): void
    register<I extends object>(
      options: {
        readonly name: 'settings.general.item'
        readonly id: string
        readonly order: number
        readonly locale: string
        readonly inject: () => I
      },
      component: (props: GeneralItemProps & I) => import('react').ReactNode,
    ): () => void
    register<I extends object>(
      options: {
        readonly name: 'plugins.row.config'
        readonly key: string
        readonly locale: string
        readonly inject: () => I
      },
      component: (props: RowConfigProps & I) => import('react').ReactNode,
    ): () => void
  }
  readonly configForms: {
    get<T>(entryId: string): ConfigForm<T>
  }
}
