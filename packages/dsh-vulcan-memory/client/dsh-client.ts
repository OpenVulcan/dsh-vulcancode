/**
 * The parts of dsh's browser runtime this client half uses.
 *
 * dsh serves these modules from its page module table; their packages are not published at the
 * Host's version, so the shapes are restated here from dsh 0.2.1-rc.2 source (the same subset
 * `dsh-vulcan-luaskills/client/dsh-client.ts` restates) and must be checked again when the
 * supported dsh range moves:
 * - `packages/client/ui-layout/src/client/index.ts` (the keyed `main` slot)
 * - `packages/client/ui-sidebar/src/client/contract/slots.ts` (`sidebar.panellist`)
 * - `packages/client/locale/src/client/index.ts` (`bind`)
 */

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

/** The browser plugin context services this client half injects. */
export interface ClientContext {
  effect(execute: () => () => void, label?: string): void
  readonly locale: {
    register(namespace: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>): () => void
    /** The current dictionary of one namespace. */
    bind(namespace: string): (key: string) => string
  }
  readonly slots: {
    inject(name: string, callback: () => () => void): void
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
