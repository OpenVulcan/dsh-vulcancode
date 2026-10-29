/**
 * The three Vulcan themes: VulcanCode's palettes mapped by meaning onto dsh's alias layer.
 *
 * The map's type is `Record<SkinToken, string>`, so it names every skin token dsh declares
 * (`dsh-tokens.ts`) and nothing else; a dsh release that adds or drops one fails the build until the
 * mapping is reviewed. Fonts, type sizes and spacing stay dsh's: they are user settings or layout.
 */

import { RADIUS_TOKENS, type SkinToken } from './dsh-tokens'
import { COMMAND, DARK, LIGHT, type Palette } from './palette'

/** Theme ids this plugin registers with dsh. */
export const VULCAN_THEME_IDS = ['vulcan-light', 'vulcan-dark', 'vulcan-command'] as const
export type VulcanThemeId = typeof VULCAN_THEME_IDS[number]

/** A theme as `ctx.theme.register` takes it. */
export interface ThemeDefinition {
  readonly id: VulcanThemeId
  readonly colorScheme: 'light' | 'dark'
  readonly tokens: Readonly<Record<string, string>>
}

/** `color-mix` of two colours in sRGB, `share` percent of the first. */
const mix = (first: string, share: number, second: string): string => `color-mix(in srgb, ${first} ${share}%, ${second})`
const fade = (color: string, share: number): string => mix(color, share, 'transparent')
const shade = (p: Palette, alpha: number): string => `rgba(${p.shade}, ${alpha})`
const light = (p: Palette): boolean => p.scheme === 'light'

/** Every dsh skin token, restated from one palette. */
export function skinTokens(p: Palette): Record<SkinToken, string> {
  return {
    // Surfaces: canvas, framed objects, floating objects, wells.
    '--dsw-alias-bg-base': p.ground,
    '--dsw-alias-bg-layer-1': p.panel,
    '--dsw-alias-bg-layer-2': p.raised,
    '--dsw-alias-bg-layer-3': mix(p.raised, 94, p.ink),
    '--dsw-alias-bg-module-platform': p.sunken,
    '--dsw-alias-bg-overlay': p.hover,
    '--dsw-alias-bg-multi-select': p.select,
    '--dsw-alias-bg-skeleton': fade(p.ink, 7),
    '--dsw-alias-bg-document-preview': p.ground2,
    '--dsw-alias-bg-document-selection': fade(p.signal, 35),
    '--dsw-alias-label-document-preview': p.ink2,
    '--dsw-alias-bg-mask-1': shade(p, light(p) ? 0.24 : 0.5),
    '--dsw-alias-bg-mask-2': shade(p, light(p) ? 0.12 : 0.2),
    '--dsw-alias-bg-mask-3': shade(p, 0.48),
    '--dsw-alias-bg-mask-photo': shade(p, 0.88),
    '--dsw-alias-bg-mask-drop': fade(p.panel, 70),
    '--dsw-alias-settings-card-fill': p.panel,
    '--dsw-alias-settings-card-stroke': p.line,

    // Borders: VulcanCode's three hairline weights.
    '--dsw-alias-border-l1': p.lineSoft,
    '--dsw-alias-border-l2': p.line,
    '--dsw-alias-border-l2-darkmode-thin': light(p) ? p.line : p.lineSoft,
    '--dsw-alias-border-l3': mix(p.line, 50, p.lineStrong),
    '--dsw-alias-border-l4': p.lineStrong,
    '--dsw-alias-border-inverted': light(p) ? 'transparent' : p.lineSoft,
    '--dsw-alias-border-inverted2': light(p) ? 'transparent' : p.line,

    // Text tiers.
    '--dsw-alias-label-primary': p.ink,
    '--dsw-alias-label-primary-dimmed': p.ink,
    '--dsw-alias-label-primary-bluish': mix(p.ink, 80, p.signal),
    '--dsw-alias-label-secondary': p.ink2,
    '--dsw-alias-label-tertiary': p.ink3,
    '--dsw-alias-label-caption': p.ink3,
    '--dsw-alias-label-dimmed': p.lineStrong,
    '--dsw-alias-label-primary-foreground': p.inkInverse,
    '--dsw-alias-label-primary-inverted': p.inkInverse,
    '--dsw-alias-label-shimmer': fade(p.ink, light(p) ? 30 : 45),
    '--dsw-alias-menu-icon': p.ink2,
    '--dsw-alias-link': p.signal,

    // Brand: ink carries structure; the ember is ambience and AI activity.
    '--dsw-alias-brand-primary': p.ink,
    '--dsw-alias-brand-primary-invert': p.ink,
    '--dsw-alias-brand-text': p.ink,
    '--dsw-alias-brand-primary-new-colorprimary-new-color': p.ember,
    '--dsw-alias-label-deep-diving': p.emberInk,
    '--dsw-alias-label-deep-diving-shimmer': p.ember2,
    '--dsw-alias-onboarding-accent': p.ember,
    '--dsw-alias-onboarding-card-fill': fade(p.panel, 80),
    '--dsw-alias-onboarding-secondary-fill': p.raised,
    '--dsw-alias-onboarding-checkbox-border': p.lineStrong,

    // Buttons: VulcanCode's primary is an ink fill. dsh's info fill is the send button, which is
    // VulcanCode's one ember control in the composer.
    '--dsw-alias-button-primary-fill': p.ink,
    '--dsw-alias-button-primary-hover': mix(p.ink, 86, p.ground),
    '--dsw-alias-button-primary-dimmed': mix(p.ink, 14, p.raised),
    '--dsw-alias-button-contrast-fill': light(p) ? p.ink2 : p.ink,
    '--dsw-alias-button-elevated-fill': p.raised,
    '--dsw-alias-button-floating-fill': p.raised,
    '--dsw-alias-button-floating-hover': p.hover,
    '--dsw-alias-button-ghost-active-fill': p.select,
    '--dsw-alias-button-ghost-active-hover': mix(p.select, 90, p.ink),
    '--dsw-alias-button-ghost-active-border': p.ink3,
    '--dsw-alias-button-info-fill': p.ember,
    '--dsw-alias-button-info-hover': p.ember2,
    '--dsw-alias-button-tool-bar-fill': shade(p, 0.5),
    '--dsw-alias-button-tool-bar-fill-invisible': shade(p, 0.36),
    '--dsw-alias-button-tool-bar-hover': shade(p, 0.6),
    '--dsw-alias-switch-thumb': light(p) ? p.inkInverse : p.ink2,

    // Interaction washes, usable over any surface.
    '--dsw-alias-interactive-bg-hover': p.hoverWash,
    '--dsw-alias-interactive-bg-hover-solid': p.hover,
    '--dsw-alias-interactive-bg-active': p.selectWash,
    '--dsw-alias-interactive-bg-hover-accent': fade(p.signal, 18),
    '--dsw-alias-interactive-bg-hover-danger': fade(p.bad, 10),
    '--dsw-alias-turn-trigger-bg': p.sunken,
    '--dsw-alias-turn-trigger-bg-hover': p.hoverWash,

    // States.
    '--dsw-alias-state-business-primary': p.signal,
    '--dsw-alias-state-business-tertiary': p.signalSoft,
    '--dsw-alias-state-error-primary': p.bad,
    '--dsw-alias-state-error-secondary': mix(p.bad, 80, p.inkInverse),
    '--dsw-alias-state-success-primary': p.ok,
    '--dsw-alias-state-success-secondary': mix(p.ok, 80, p.inkInverse),
    '--dsw-alias-state-success-tertiary': mix(p.ok, 14, p.panel),
    '--dsw-alias-state-warn-label': p.warn,
    '--dsw-alias-state-warn-primary': p.warn,
    '--dsw-alias-state-warn-secondary': mix(p.warn, 80, p.inkInverse),
    '--dsw-alias-state-warn-tertiary': mix(p.warn, 14, p.panel),
    '--dsw-alias-state-idle-primary': p.lineStrong,

    // Code and diffs.
    '--dsw-alias-markdown-code-block': p.codeBg,
    '--dsw-alias-markdown-code-block-banner': p.codeBg,
    '--dsw-alias-markdown-code-segment-selected': p.panel,
    '--dsw-alias-markdown-code-segment-unselected': p.sunken,
    '--dsw-alias-markdown-inline-code': p.codeBg,
    '--dsw-alias-markdown-citation': p.hover,
    '--dsw-alias-markdown-placeholder': p.sunken,
    '--dsw-alias-markdown-tag': p.hover,
    '--dsw-alias-code-diff-added': p.diffAddBg,
    '--dsw-alias-code-diff-deleted': p.diffDelBg,
    '--dsw-alias-file-diff-added-bg': p.diffAddBg,
    '--dsw-alias-file-diff-added-gutter': mix(p.diffAddBg, 60, p.codeBg),
    '--dsw-alias-file-diff-added-marker': p.diffAddInk,
    '--dsw-alias-file-diff-deleted-bg': p.diffDelBg,
    '--dsw-alias-file-diff-deleted-gutter': mix(p.diffDelBg, 60, p.codeBg),
    '--dsw-alias-file-diff-deleted-marker': p.diffDelInk,

    // Floating feedback: VulcanCode's tooltip is an ink plate.
    '--dsw-alias-tooltip-bg': p.ink,
    '--dsw-alias-tooltip-key-bg': mix(p.ink, 82, p.inkInverse),
    '--dsw-alias-toast-bg': p.ink,
    '--dsw-alias-toast-label': p.inkInverse,

    // Menus are solid raised plates, as in VulcanCode.
    '--dsw-menu-surface-fill': p.raised,
    '--dsw-alias-menu-group-header-fill': p.raised,
    '--dsw-specific-menu': p.raised,

    '--dsw-alias-scrollbar-bg-l1': p.scrollbar,
    '--dsw-alias-scrollbar-bg-l2': p.scrollbar,
    '--dsw-alias-scrollbar-hover-l1': p.scrollbarHover,
    '--dsw-alias-scrollbar-hover-l2': p.scrollbarHover,

    '--dsw-shadow-lv1': p.shadow1,
    '--dsw-shadow-lv1-blur': p.shadow1,
    '--dsw-shadow-lv2': p.shadow1,
    '--dsw-shadow-lv3': p.shadow2,
    '--dsw-linear-gradient-think': `linear-gradient(180deg, ${p.ground} 20.19%, ${fade(p.ground, 0)} 100%)`,
    '--dsw-linear-think-select': `linear-gradient(180deg, ${p.sunken} 20.19%, ${fade(p.sunken, 0)} 100%)`,

    // Shell: the navigation well, the composer, the user's prompts.
    '--dsw-specific-sidebar-fill': mix(p.ground2, 45, p.ground),
    '--dsw-specific-sidebar-nav-item-hover': p.hover,
    '--dsw-specific-sidebar-nav-item-active': p.select,
    '--dsw-specific-sidebar-nav-item-active-accent': p.emberSoft,
    '--dsw-specific-input-major': p.raised,
    '--dsw-specific-login-input': p.sunken,
    '--dsw-specific-bubble': p.panel,
    '--dsw-specific-bubble-highlight': p.select,
    '--dsw-specific-selector': p.sunken,
    '--dsw-specific-tip': p.sunken,
  }
}

/** Each theme's palette. */
export const PALETTES: Readonly<Record<VulcanThemeId, Palette>> = {
  'vulcan-light': LIGHT,
  'vulcan-dark': DARK,
  'vulcan-command': COMMAND,
}

/** The definitions registered with dsh, in display order. */
export const THEMES: readonly ThemeDefinition[] = VULCAN_THEME_IDS.map(id => ({
  id,
  colorScheme: PALETTES[id].scheme,
  tokens: skinTokens(PALETTES[id]),
}))

/** Whether a theme id is one of this plugin's. */
export function isVulcanTheme(id: string): id is VulcanThemeId {
  return (VULCAN_THEME_IDS as readonly string[]).includes(id)
}

/** The override layer that squares every corner dsh draws through its radius tokens, in both palettes. */
export function squareCornerTokens(): Record<string, { light: string; dark: string }> {
  return Object.fromEntries(RADIUS_TOKENS.map(name => [name, { light: '0px', dark: '0px' }]))
}
