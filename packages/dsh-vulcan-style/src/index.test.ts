import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { shared } from './browser.test.support.js'
import { Config, THEME_CHOICES } from './index.js'

describe('suite wiring', () => {
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

  it('names this package and the suite row that loads it', () => {
    const { PACKAGE_NAME, SUITE_PACKAGE, ENTRY_ID, ROW_CONFIG_KEY } = shared()
    assert.equal(PACKAGE_NAME, (JSON.parse(read('../package.json')) as { name: string }).name)
    assert.equal(SUITE_PACKAGE, (JSON.parse(read('../../dsh-vulcancode/package.json')) as { name: string }).name)
    const patch = read('../../dsh-vulcancode/cordis.patch.yml')
    assert.match(patch, new RegExp(`- id: ${ENTRY_ID}\\s+name: '${PACKAGE_NAME}'`),
      'the suite patch must declare this package under the row id its configuration namespace and Plugins-page key use')
    assert.equal(ROW_CONFIG_KEY, `${SUITE_PACKAGE}#${ENTRY_ID}`)
  })
})

describe('Config', () => {
  it('offers the same theme choices the browser half understands', () => {
    assert.deepEqual([...THEME_CHOICES], [...shared().THEME_CHOICES])
  })

  it('resolves an empty configuration to the browser half\'s defaults', () => {
    const config = Config({})
    const { DEFAULT_SETTINGS, settingsOf } = shared()
    assert.equal(config.theme.get(), DEFAULT_SETTINGS.theme)
    assert.equal(config.squareCorners.get(), DEFAULT_SETTINGS.squareCorners)
    assert.deepEqual(settingsOf(undefined), DEFAULT_SETTINGS)
  })

  it('accepts every theme choice and rejects unknown ones', () => {
    for (const theme of THEME_CHOICES) assert.equal(Config({ theme }).theme.get(), theme)
    assert.throws(() => Config({ theme: 'vulcan-sepia' } as never))
    assert.throws(() => Config({ squareCorners: 'yes' } as never))
  })

  it('describes every field in English and Chinese', () => {
    const fields = (Config as unknown as { dict: Record<string, { meta: { description?: unknown } }> }).dict
    for (const [key, field] of Object.entries(fields)) {
      const description = field.meta.description as Record<string, string> | undefined
      assert.equal(typeof description?.['en'], 'string', `${key} en`)
      assert.equal(typeof description?.['zh'], 'string', `${key} zh`)
    }
  })
})

describe('settingsOf', () => {
  it('keeps valid fields and falls back per field', () => {
    const { settingsOf, DEFAULT_SETTINGS } = shared()
    assert.deepEqual(settingsOf({ theme: 'dsh', squareCorners: false }), { theme: 'dsh', squareCorners: false })
    assert.deepEqual(settingsOf({ theme: 'nope', squareCorners: false }), { theme: DEFAULT_SETTINGS.theme, squareCorners: false })
  })
})
