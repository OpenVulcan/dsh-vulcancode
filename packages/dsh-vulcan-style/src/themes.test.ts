import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { i18n, themes, tokens } from './browser.test.support.js'

const { THEMES, VULCAN_THEME_IDS, PALETTES, isVulcanTheme, squareCornerTokens } = themes()
const { SKIN_TOKENS, RADIUS_TOKENS } = tokens()

describe('Vulcan themes', () => {
  it('registers one definition per theme id, with unique ids', () => {
    assert.deepEqual(THEMES.map(theme => theme.id), [...VULCAN_THEME_IDS])
    assert.equal(new Set(VULCAN_THEME_IDS).size, VULCAN_THEME_IDS.length)
    for (const id of VULCAN_THEME_IDS) assert.ok(isVulcanTheme(id))
    for (const builtin of ['light', 'dark', 'system']) assert.ok(!isVulcanTheme(builtin))
  })

  it('builds each theme on the base palette its colours belong to', () => {
    for (const theme of THEMES) assert.equal(theme.colorScheme, PALETTES[theme.id]?.scheme, theme.id)
  })

  it('restates exactly the skin tokens the targeted dsh declares, in every theme', () => {
    const expected = [...SKIN_TOKENS].sort()
    for (const theme of THEMES) {
      assert.deepEqual(Object.keys(theme.tokens).sort(), expected,
        `${theme.id} must map every skin token of dsh ${tokens().DSH_TOKENS_VERSION} and nothing else; regenerate client/dsh-tokens.ts if dsh moved`)
    }
  })

  it('gives every token a non-empty value without stray declaration syntax', () => {
    for (const theme of THEMES) {
      for (const [name, value] of Object.entries(theme.tokens)) {
        assert.ok(value.trim() !== '', `${theme.id} ${name} is empty`)
        assert.ok(!/[;{}]/.test(value), `${theme.id} ${name} would break out of its declaration: ${value}`)
      }
    }
  })

  it('writes palette colours as hex or rgba() values', () => {
    const colour = /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d+)\))$/
    const colourFields = ['ground', 'ground2', 'panel', 'raised', 'sunken', 'hover', 'select', 'line', 'lineStrong', 'lineSoft',
      'ink', 'ink2', 'ink3', 'inkInverse', 'ember', 'ember2', 'emberSoft', 'emberInk', 'signal', 'signalSoft',
      'ok', 'warn', 'bad', 'codeBg', 'diffAddBg', 'diffAddInk', 'diffDelBg', 'diffDelInk', 'hoverWash', 'selectWash',
      'scrollbar', 'scrollbarHover']
    for (const [id, palette] of Object.entries(PALETTES)) {
      for (const field of colourFields) assert.match(palette[field] ?? '', colour, `${id}.${field}`)
    }
  })
})

describe('dsh token list', () => {
  it('names only custom properties, each once', () => {
    for (const name of [...SKIN_TOKENS, ...RADIUS_TOKENS]) assert.match(name, /^--dsw-[a-z0-9-]+$/)
    assert.equal(new Set(SKIN_TOKENS).size, SKIN_TOKENS.length)
    assert.equal(new Set(RADIUS_TOKENS).size, RADIUS_TOKENS.length)
    assert.ok(RADIUS_TOKENS.length > 0)
  })
})

describe('square corners', () => {
  it('zeroes every radius token in both palettes and touches nothing else', () => {
    const layer = squareCornerTokens()
    assert.deepEqual(Object.keys(layer).sort(), [...RADIUS_TOKENS].sort())
    for (const value of Object.values(layer)) assert.deepEqual(value, { light: '0px', dark: '0px' })
  })
})

describe('dictionaries', () => {
  it('have the same keys in every language and no empty text', () => {
    const { zh, en } = i18n()
    assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
    for (const text of [...Object.values(zh), ...Object.values(en)]) assert.ok(text.trim() !== '')
  })
})
