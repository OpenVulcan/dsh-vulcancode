/**
 * The parts of dsh's browser runtime this client half uses.
 *
 * dsh serves these modules from its page module table; their packages are not published at the
 * Host's version, so the shapes are restated here from dsh 0.2.1-rc.2 source and must be checked
 * again when the supported dsh range moves:
 * - `packages/client/ui-layout/src/client/index.ts` (the keyed `main` slot)
 * - `packages/client/ui-sidebar/src/client/contract/slots.ts` (`sidebar.panellist`)
 * - `packages/client/ui-settings/src/client/contract/slots.ts` (`settings.section`)
 * - `packages/client/ui-settings-general/src/client/{index,shell-store}.ts` (`sidebar.settings` store)
 * - `packages/client/locale/src/client/index.ts` (`bind`)
 */

/** Owner props of a Settings dialog section, plus the dictionary of its locale namespace. */
export interface SettingsSectionProps {
  /** Close the Settings dialog. */
  readonly close: () => void
  readonly t: (key: string) => string
}

/** Props of a `main` panel: only the dictionary of its locale namespace. */
export interface MainPanelProps {
  readonly t: (key: string) => string
}

/** Owner props of a `sidebar.panellist` icon. */
export interface PanelIconProps {
  /** Requested square edge in pixels. */
  readonly size: number
  /** Whether this panel is selected in the main column. */
  readonly active: boolean
}

/** The Settings dialog store's actions this client uses. */
export interface SettingsShell {
  readonly actions: { openSection(id: string): void }
}

/** The browser plugin context services this client half injects. */
export interface ClientContext {
  effect(execute: () => () => void, label?: string): void
  on(name: 'connection/reset', listener: () => void): () => void
  readonly locale: {
    register(namespace: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>): () => void
    /** The current dictionary of one namespace. */
    bind(namespace: string): (key: string) => string
  }
  readonly slots: {
    inject(name: string, callback: () => () => void): void
    /** Registered entries of a slot; the settings shell's carries the dialog's store. */
    entries(name: string): readonly { readonly store?: { create(): unknown } | undefined }[]
    register<I extends object>(
      options: {
        readonly name: 'settings.section'
        readonly id: string
        readonly order: number
        /** Read by the shell on every render, so it follows the interface language. */
        readonly label: () => string
        readonly locale: string
        readonly inject: () => I
      },
      component: (props: SettingsSectionProps & I) => import('react').ReactNode,
    ): () => void
    register<I extends object>(
      options: { readonly name: 'main'; readonly key: string; readonly locale: string; readonly inject: () => I },
      component: (props: MainPanelProps & I) => import('react').ReactNode,
    ): () => void
    register(
      options: {
        readonly name: 'sidebar.panellist'
        readonly id: string
        readonly order: number
        readonly locale: string
        /** Row title and accessible name, read on every render. */
        readonly label: () => string
      },
      component: (props: PanelIconProps) => import('react').ReactNode,
    ): () => void
  }
}
