/**
 * The plugin's stylesheet, in two parts:
 *
 * - The settings row (`.vst-*`), drawn with dsh's alias tokens so it follows whatever theme is active.
 * - VulcanCode's shell elements that dsh draws differently and no token reaches: the ember marks on
 *   the current place, the framed menus and dialogs, and the settings navigation.
 *   These rules apply only while a Vulcan theme is active (`html[data-vulcan-theme]`, set by
 *   `controller.ts`) and reach dsh only through stable hooks: slot names (`data-slot`, whose elements
 *   are `display: contents`, so rules go to their children or ancestors), other data attributes, ARIA
 *   roles and states, and the semantic `md-*` classes, never the hashed CSS-module class names.
 */

import { SQUARE_ATTRIBUTE, THEME_ATTRIBUTE } from './controller'
import type { Palette } from './palette'
import { PACKAGE_NAME } from './shared'
import { PALETTES, VULCAN_THEME_IDS } from './themes'

/** Plugin variables per Vulcan theme, read by the scoped rules below. */
const themeVariables = (name: string, p: Palette): string => `html[${THEME_ATTRIBUTE}="${name}"] {
  --vulcan-ground-2: ${p.ground2};
  --vulcan-panel: ${p.panel};
  --vulcan-hover: ${p.hover};
  --vulcan-line: ${p.line};
  --vulcan-line-strong: ${p.lineStrong};
  --vulcan-ink: ${p.ink};
  --vulcan-ink-2: ${p.ink2};
  --vulcan-ink-3: ${p.ink3};
  --vulcan-ink-inverse: ${p.inkInverse};
  --vulcan-ember: ${p.ember};
  --vulcan-signal-soft: ${p.signalSoft};
  --vulcan-shadow-1: ${p.shadow1};
  --vulcan-shadow-2: ${p.shadow2};
  --vulcan-scrim: ${p.scrim};
  --vulcan-ambient: ${p.ambient};
}`

/** Root of every scoped rule. */
const V = `html[${THEME_ATTRIBUTE}]`
/** The settings dialog. */
const SETTINGS = `${V} [data-shortcut-modal="settings"]`
/** The workspace tree in the sidebar. */
const TREE = `${V} [data-slot="sidebar.workspaces"] [role="tree"]`

const VULCAN = `
${VULCAN_THEME_IDS.map(id => themeVariables(id.slice('vulcan-'.length), PALETTES[id])).join('\n')}
${V} {
  --vulcan-tick-w: 28px;
  --vulcan-font-mono: "Geist Mono", "JetBrains Mono", "Cascadia Mono", Consolas, monospace;
  --vulcan-label-font: inherit;
  --vulcan-label-case: none;
  --vulcan-label-track: 0;
}
/* The command bridge sets its labels in capitals of the mono face, as VulcanCode's HUD does. */
html[${THEME_ATTRIBUTE}="command"] {
  --vulcan-label-font: var(--vulcan-font-mono);
  --vulcan-label-case: uppercase;
  --vulcan-label-track: 0.08em;
}
${V} ::selection { background: var(--vulcan-signal-soft); color: var(--dsw-alias-label-primary); }
/* The ember and signal glow behind the conversation; its scroll port is transparent over the canvas. */
${V} [data-conversation-scroll] { background-image: var(--vulcan-ambient); background-attachment: fixed; }
/* Code blocks are framed objects in VulcanCode: a hairline frame and a ruled header. */
${V} .md-code-block { border: 1px solid var(--dsw-alias-border-l2); }
${V} .md-code-block [data-code-block-banner] { border-bottom: 1px solid var(--dsw-alias-border-l1); }

/* Sidebar. New session is VulcanCode's primary action: an ink plate. */
${V} [data-slot="sidebar"] > * > button[aria-keyshortcuts] { background: var(--vulcan-ink); color: var(--vulcan-ink-inverse); box-shadow: 0 0 0 1px var(--vulcan-ink); }
${V} [data-slot="sidebar"] > * > button[aria-keyshortcuts]:hover { background: color-mix(in srgb, var(--vulcan-ink) 86%, var(--vulcan-ground-2)); }
/* The current session is a framed panel row with an ember edge; its workspace's folder takes the ember. */
${TREE} [role="treeitem"][aria-selected="true"] { position: relative; background: var(--vulcan-panel); box-shadow: inset 0 0 0 1px var(--vulcan-line); color: var(--vulcan-ink); }
${TREE} [role="treeitem"][aria-selected="true"]::before { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 2px; background: var(--vulcan-ember); pointer-events: none; }
${TREE} [role="treeitem"][data-row-key^="workspace:"] > :first-child { color: var(--vulcan-ink-3); }
${TREE} > :has([role="treeitem"][aria-selected="true"]) [role="treeitem"][data-row-key^="workspace:"] > :first-child { color: var(--vulcan-ember); }
/* The account row sits under a rule, like VulcanCode's sidebar foot. */
${V} [data-slot="sidebar"] > * > :has(> * > [data-slot="sidebar.settings"]) { padding-top: 6px; box-shadow: 0 -1px 0 var(--vulcan-line); }

/* Composer: a quiet floating card whose edge deepens while typing. */
${V} [data-composer-card] { box-shadow: 0 0 0 1px var(--vulcan-line-strong), var(--vulcan-shadow-1); transition: box-shadow .16s ease; }
${V} [data-composer-card]:focus-within { box-shadow: 0 0 0 1px var(--vulcan-ink-3), var(--vulcan-shadow-2); }

/* Menus and dialogs are framed raised plates; a dialog's backdrop is a light frosted glass. */
${V} [role="menu"][data-menu-material] { box-shadow: 0 0 0 1px var(--vulcan-line-strong), var(--vulcan-shadow-2); }
${V} [role="dialog"][aria-modal="true"] { box-shadow: 0 0 0 1px var(--vulcan-line-strong), var(--vulcan-shadow-2); }
${V} [aria-hidden="true"]:has(+ [role="dialog"][aria-modal="true"]) { background: var(--vulcan-scrim); backdrop-filter: blur(3px) saturate(1.05); }

/* Settings: an ember corner tick and a navigation well whose current page carries the ember edge. */
${SETTINGS}::before { content: ""; position: absolute; z-index: 1; top: -1px; left: -1px; width: var(--vulcan-tick-w); height: 2px; background: var(--vulcan-ember); pointer-events: none; }
${SETTINGS} > nav { background: var(--vulcan-ground-2); box-shadow: inset -1px 0 0 var(--vulcan-line); }
${SETTINGS} > nav button { color: var(--vulcan-ink-2); }
${SETTINGS} > nav button:hover { background: var(--vulcan-hover); color: var(--vulcan-ink); }
${SETTINGS} > nav button[aria-current="true"] { background: var(--vulcan-panel); color: var(--vulcan-ink); box-shadow: inset 2px 0 0 var(--vulcan-ember), 0 0 0 1px var(--vulcan-line); }
${SETTINGS} > nav button[aria-current="true"] svg { color: var(--vulcan-ember); }
${V} [data-slot="settings.header"] { color: var(--vulcan-ink-3); font-family: var(--vulcan-label-font); font-size: 12px; font-weight: 500; letter-spacing: var(--vulcan-label-track); text-transform: var(--vulcan-label-case); }
`

const ROW = `
.vst { display: flex; flex-direction: column; gap: 12px; padding: 16px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.vst-head { display: flex; flex-direction: column; gap: 4px; }
.vst-title { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); }
.vst-desc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.vst-error { font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
.vst-choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
.vst-choice { position: relative; display: flex; flex-direction: column; align-items: stretch; gap: 8px; padding: 10px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; text-align: left; cursor: pointer; }
.vst-choice:disabled { cursor: default; opacity: .6; }
@media (hover: hover) { .vst-choice:hover:not([aria-pressed="true"]):not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); } }
.vst-choice[aria-pressed="true"] { background: var(--dsw-alias-bg-module-platform); border-color: var(--dsw-alias-label-tertiary); }
.vst-swatch { display: flex; height: 28px; overflow: hidden; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-xs); }
.vst-swatch > span { flex: 1; }
.vst-swatch > span[data-accent] { flex: 0 0 6px; }
.vst-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.vst-switch { position: relative; flex: none; width: 36px; height: 20px; padding: 0; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: 999px; background: var(--dsw-alias-bg-module-platform); cursor: pointer; }
.vst-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 999px; background: var(--dsw-alias-label-tertiary); transition: transform .15s ease; }
.vst-switch[aria-checked="true"] { background: var(--dsw-alias-state-business-primary); border-color: var(--dsw-alias-state-business-primary); }
.vst-switch[aria-checked="true"]::after { background: var(--dsw-alias-label-primary-foreground); transform: translateX(16px); }
.vst-switch:disabled { cursor: default; opacity: .6; }
html[${SQUARE_ATTRIBUTE}] .vst-switch,
html[${SQUARE_ATTRIBUTE}] .vst-switch::after { border-radius: 0; }
`

/** Add the stylesheet once per page; returns a function that removes it again. */
export function installStyle(): () => void {
  document.querySelector(`style[data-plugin="${PACKAGE_NAME}"]`)?.remove()
  const tag = document.createElement('style')
  tag.dataset['plugin'] = PACKAGE_NAME
  tag.textContent = VULCAN + ROW
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
