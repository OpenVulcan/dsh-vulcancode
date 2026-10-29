/**
 * The plugin's stylesheet, in two parts:
 *
 * - The settings row (`.vst-*`), drawn with dsh's alias tokens so it follows whatever theme is active.
 * - The few places VulcanCode differs from what dsh draws with fixed values. These rules apply only
 *   while a Vulcan theme is active (`html[data-vulcan-theme]`, set by `controller.ts`) and reach dsh
 *   only through stable hooks: data attributes and the semantic `md-*` classes, never the hashed
 *   CSS-module class names.
 */

import { SQUARE_ATTRIBUTE, THEME_ATTRIBUTE } from './controller'
import type { Palette } from './palette'
import { PACKAGE_NAME } from './shared'
import { PALETTES, VULCAN_THEME_IDS } from './themes'

/** Plugin variables per Vulcan theme, read by the scoped rules below. */
const themeVariables = (name: string, p: Palette): string => `html[${THEME_ATTRIBUTE}="${name}"] {
  --vulcan-ember: ${p.ember};
  --vulcan-signal-soft: ${p.signalSoft};
  --vulcan-ambient: ${p.ambient};
}`

const VULCAN = `
${VULCAN_THEME_IDS.map(id => themeVariables(id.slice('vulcan-'.length), PALETTES[id])).join('\n')}
html[${THEME_ATTRIBUTE}] ::selection { background: var(--vulcan-signal-soft); color: var(--dsw-alias-label-primary); }
/* The ember and signal glow behind the conversation; its scroll port is transparent over the canvas. */
html[${THEME_ATTRIBUTE}] [data-conversation-scroll] { background-image: var(--vulcan-ambient); background-attachment: fixed; }
/* Code blocks are framed objects in VulcanCode: a hairline frame and a ruled header. */
html[${THEME_ATTRIBUTE}] .md-code-block { border: 1px solid var(--dsw-alias-border-l2); }
html[${THEME_ATTRIBUTE}] .md-code-block [data-code-block-banner] { border-bottom: 1px solid var(--dsw-alias-border-l1); }
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
