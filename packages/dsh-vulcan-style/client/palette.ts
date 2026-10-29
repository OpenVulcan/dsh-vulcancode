/**
 * VulcanCode's three palettes, restated from its ui-kit
 * (`apps/vulcan-code-web/src/ui-kit/styles/tokens.css`, the `--vk-*` skin surface). Re-read that file
 * when VulcanCode's palette changes.
 *
 * Neutrals carry the structure, the flame ("ember") is ambience and AI activity only, and a cool
 * "signal" hue marks focus, selection and links. The command palette's translucent panels sit over
 * a HUD grid in VulcanCode; dsh paints them as plain surfaces, so they are restated here as the
 * opaque colour they produce over the command ground.
 */

/** One VulcanCode palette, named after its `--vk-*` tokens. */
export interface Palette {
  readonly scheme: 'light' | 'dark'
  /** App canvas. */
  readonly ground: string
  /** Second canvas tone (navigation wells, document backgrounds). */
  readonly ground2: string
  /** Framed objects: cards, messages. */
  readonly panel: string
  /** Floating objects: composer, menus, popovers. */
  readonly raised: string
  /** Wells inside panels. */
  readonly sunken: string
  /** Solid hover fill. */
  readonly hover: string
  /** Solid selection fill. */
  readonly select: string
  /** Hover as a wash that works over any surface. */
  readonly hoverWash: string
  /** Selection as a wash that works over any surface. */
  readonly selectWash: string
  readonly line: string
  readonly lineStrong: string
  readonly lineSoft: string
  /** Text tiers; each keeps 4.5:1 on every surface of its palette. */
  readonly ink: string
  readonly ink2: string
  readonly ink3: string
  readonly inkInverse: string
  readonly ember: string
  readonly ember2: string
  readonly emberSoft: string
  readonly emberInk: string
  readonly signal: string
  readonly signalSoft: string
  readonly ok: string
  readonly warn: string
  readonly bad: string
  readonly codeBg: string
  readonly diffAddBg: string
  readonly diffAddInk: string
  readonly diffDelBg: string
  readonly diffDelInk: string
  readonly shadow1: string
  readonly shadow2: string
  /** RGB channels of the palette's darkest shade, for scrims and media toolbars. */
  readonly shade: string
  /** The light frosted layer behind a dialog (VulcanCode's `--vk-scrim`). */
  readonly scrim: string
  /** Scrollbar thumb and its hover colour. */
  readonly scrollbar: string
  readonly scrollbarHover: string
  /** The ember and signal glow behind the canvas (VulcanCode's `--vk-ambient`, without the HUD grid). */
  readonly ambient: string
}

export const LIGHT: Palette = {
  scheme: 'light',
  ground: '#f2f3f5',
  ground2: '#ebedf0',
  panel: '#ffffff',
  raised: '#ffffff',
  sunken: '#f6f7f9',
  hover: '#e8ebef',
  select: '#e3e9f8',
  hoverWash: 'rgba(20, 23, 28, 0.09)',
  selectWash: 'rgba(46, 88, 204, 0.13)',
  line: '#dde1e6',
  lineStrong: '#c3c9d1',
  lineSoft: '#eaecef',
  ink: '#14171c',
  ink2: '#4a515c',
  ink3: '#626973',
  inkInverse: '#ffffff',
  ember: '#e2511a',
  ember2: '#f5872e',
  emberSoft: '#fcebe2',
  emberInk: '#ad3d0d',
  signal: '#2e58cc',
  signalSoft: '#e4eafa',
  ok: '#18774a',
  warn: '#945d09',
  bad: '#c3303d',
  codeBg: '#f4f5f7',
  diffAddBg: '#e6f4eb',
  diffAddInk: '#16643d',
  diffDelBg: '#fbe9ea',
  diffDelInk: '#a32632',
  shadow1: '0 1px 2px rgba(17, 21, 28, 0.05)',
  shadow2: '0 12px 32px rgba(17, 21, 28, 0.14), 0 2px 6px rgba(17, 21, 28, 0.06)',
  shade: '16, 19, 24',
  scrim: 'rgba(16, 19, 24, 0.08)',
  scrollbar: '#c3c9d1',
  scrollbarHover: '#626973',
  ambient: 'radial-gradient(70rem 30rem at 8% -12%, rgba(226, 81, 26, 0.07), transparent 62%), '
    + 'radial-gradient(60rem 36rem at 105% 0%, rgba(46, 88, 204, 0.05), transparent 60%)',
}

export const DARK: Palette = {
  scheme: 'dark',
  ground: '#0c0e11',
  ground2: '#101317',
  panel: '#15181d',
  raised: '#1b1f25',
  sunken: '#0f1215',
  hover: '#1e2329',
  select: '#1c2537',
  hoverWash: 'rgba(230, 233, 237, 0.06)',
  selectWash: 'rgba(125, 157, 255, 0.11)',
  line: '#23282f',
  lineStrong: '#343b45',
  lineSoft: '#1a1e24',
  ink: '#e6e9ed',
  ink2: '#a2aab5',
  ink3: '#848c97',
  inkInverse: '#0c0e11',
  ember: '#ff6a2b',
  ember2: '#ff9a40',
  emberSoft: '#2a1810',
  emberInk: '#ff9b68',
  signal: '#7d9dff',
  signalSoft: '#1a2236',
  ok: '#3fc48a',
  warn: '#e0a83a',
  bad: '#f0646f',
  codeBg: '#111418',
  diffAddBg: '#0f251a',
  diffAddInk: '#72d6a2',
  diffDelBg: '#2d1316',
  diffDelInk: '#f38c94',
  shadow1: '0 1px 2px rgba(0, 0, 0, 0.4)',
  shadow2: '0 16px 40px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.4)',
  shade: '0, 0, 0',
  scrim: 'rgba(0, 0, 0, 0.18)',
  scrollbar: '#343b45',
  scrollbarHover: '#848c97',
  ambient: 'radial-gradient(64rem 30rem at 50% 118%, rgba(255, 106, 43, 0.11), transparent 66%), '
    + 'radial-gradient(52rem 26rem at -4% -8%, rgba(125, 157, 255, 0.06), transparent 60%)',
}

export const COMMAND: Palette = {
  scheme: 'dark',
  ground: '#03060b',
  // rgba(5, 11, 18, 0.86) over the ground.
  ground2: '#050a11',
  // rgba(8, 17, 27, 0.78) over the ground.
  panel: '#070f18',
  raised: '#0a1520',
  // rgba(2, 7, 12, 0.82) over the ground.
  sunken: '#02070c',
  // rgba(56, 214, 255, 0.07) and 0.13 over the panel.
  hover: '#0a1d28',
  select: '#0d2936',
  hoverWash: 'rgba(56, 214, 255, 0.07)',
  selectWash: 'rgba(56, 214, 255, 0.13)',
  line: '#12303e',
  lineStrong: '#1d4b60',
  lineSoft: '#0c2230',
  ink: '#d8f3ff',
  ink2: '#8cb2c3',
  ink3: '#6d92a3',
  inkInverse: '#03060b',
  ember: '#ff7a2f',
  ember2: '#ffb24a',
  // rgba(255, 122, 47, 0.12) over the panel.
  emberSoft: '#251c1b',
  emberInk: '#ffa56d',
  signal: '#38d6ff',
  // rgba(56, 214, 255, 0.12) over the panel.
  signalSoft: '#0d2734',
  ok: '#34e5a1',
  warn: '#ffc44d',
  bad: '#ff5068',
  // rgba(2, 8, 14, 0.85) over the ground.
  codeBg: '#02080e',
  // rgba(52, 229, 161, 0.1) and rgba(255, 80, 104, 0.1) over the code background.
  diffAddBg: '#071e1d',
  diffAddInk: '#6ff0bf',
  diffDelBg: '#1b0f17',
  diffDelInk: '#ff8d9f',
  shadow1: '0 0 0 1px rgba(56, 214, 255, 0.04)',
  shadow2: '0 0 0 1px rgba(56, 214, 255, 0.22), 0 18px 48px rgba(0, 0, 0, 0.7), 0 0 32px rgba(56, 214, 255, 0.08)',
  shade: '1, 4, 9',
  scrim: 'rgba(1, 4, 9, 0.22)',
  // color-mix(in srgb, signal 38%, transparent), as VulcanCode's command scrollbar.
  scrollbar: 'rgba(56, 214, 255, 0.38)',
  scrollbarHover: '#6d92a3',
  ambient: 'radial-gradient(70rem 26rem at 50% 116%, rgba(255, 122, 47, 0.16), transparent 70%), '
    + 'radial-gradient(90rem 34rem at 50% -24%, rgba(56, 214, 255, 0.11), transparent 66%), '
    + 'repeating-linear-gradient(0deg, rgba(56, 214, 255, 0.04) 0 1px, transparent 1px 32px), '
    + 'repeating-linear-gradient(90deg, rgba(56, 214, 255, 0.04) 0 1px, transparent 1px 32px)',
}
