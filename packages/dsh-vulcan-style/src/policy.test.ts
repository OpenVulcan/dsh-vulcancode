import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { policy, themes } from './browser.test.support.js'

const { reactToPreference, wantedTheme, isUserInputEvent, BUILTIN_PREFERENCES } = policy()
const { VULCAN_THEME_IDS } = themes()
const VULCAN_CHOICES = ['vulcan-auto', ...VULCAN_THEME_IDS]

describe('wantedTheme', () => {
  it('follows the system scheme for vulcan-auto', () => {
    assert.equal(wantedTheme('vulcan-auto', false), 'vulcan-light')
    assert.equal(wantedTheme('vulcan-auto', true), 'vulcan-dark')
  })

  it('names the chosen theme regardless of the system scheme, and nothing for dsh', () => {
    for (const id of VULCAN_THEME_IDS) {
      assert.equal(wantedTheme(id, false), id)
      assert.equal(wantedTheme(id, true), id)
    }
    assert.equal(wantedTheme('dsh', true), undefined)
  })
})

describe('reactToPreference', () => {
  it('applies the Vulcan theme again when dsh falls back to a built-in preference by itself', () => {
    for (const choice of VULCAN_CHOICES) {
      for (const preference of BUILTIN_PREFERENCES) {
        const reaction = reactToPreference({ choice, prefersDark: true, preference, userInput: false })
        assert.deepEqual(reaction, { kind: 'apply', id: wantedTheme(choice, true) })
      }
    }
  })

  it('records "dsh" when the user picks a built-in theme in dsh\'s own interface', () => {
    for (const choice of VULCAN_CHOICES) {
      for (const preference of BUILTIN_PREFERENCES) {
        assert.deepEqual(reactToPreference({ choice, prefersDark: false, preference, userInput: true }), { kind: 'record', choice: 'dsh' })
      }
    }
  })

  it('leaves dsh alone once the choice is "dsh"', () => {
    for (const preference of BUILTIN_PREFERENCES) {
      for (const userInput of [true, false]) {
        assert.deepEqual(reactToPreference({ choice: 'dsh', prefersDark: false, preference, userInput }), { kind: 'none' })
      }
    }
  })

  it('does nothing when the preference already is the wanted theme', () => {
    for (const userInput of [true, false]) {
      assert.deepEqual(reactToPreference({ choice: 'vulcan-command', prefersDark: false, preference: 'vulcan-command', userInput }), { kind: 'none' })
      assert.deepEqual(reactToPreference({ choice: 'vulcan-auto', prefersDark: true, preference: 'vulcan-dark', userInput }), { kind: 'none' })
    }
  })

  it('records a different Vulcan theme the user picks, and corrects one nobody picked', () => {
    assert.deepEqual(
      reactToPreference({ choice: 'vulcan-light', prefersDark: false, preference: 'vulcan-command', userInput: true }),
      { kind: 'record', choice: 'vulcan-command' },
    )
    assert.deepEqual(
      reactToPreference({ choice: 'vulcan-auto', prefersDark: true, preference: 'vulcan-light', userInput: false }),
      { kind: 'apply', id: 'vulcan-dark' },
    )
  })

  it('does not fight another plugin\'s theme applied without user input, but records a user\'s pick of it', () => {
    assert.deepEqual(reactToPreference({ choice: 'vulcan-dark', prefersDark: false, preference: 'other-theme', userInput: false }), { kind: 'none' })
    assert.deepEqual(
      reactToPreference({ choice: 'vulcan-dark', prefersDark: false, preference: 'other-theme', userInput: true }),
      { kind: 'record', choice: 'dsh' },
    )
  })
})

describe('isUserInputEvent', () => {
  it('accepts only trusted pointer, keyboard and form events', () => {
    assert.ok(isUserInputEvent({ type: 'click', isTrusted: true }))
    assert.ok(isUserInputEvent({ type: 'keydown', isTrusted: true }))
    assert.ok(!isUserInputEvent({ type: 'click', isTrusted: false }))
    assert.ok(!isUserInputEvent({ type: 'message', isTrusted: true }))
    assert.ok(!isUserInputEvent(undefined))
  })
})
