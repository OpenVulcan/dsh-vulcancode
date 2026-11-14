import assert from 'node:assert/strict'
import { test } from 'node:test'
import { preparedUnixTarget } from './unix-runtime.js'

test('Unix payload selection follows the process architecture, including Rosetta', () => {
  assert.equal(preparedUnixTarget('linux', 'arm64'), 'linux-arm64')
  assert.equal(preparedUnixTarget('linux', 'x64'), 'linux-x64')
  assert.equal(preparedUnixTarget('darwin', 'arm64'), 'macos-arm64')
  assert.equal(preparedUnixTarget('darwin', 'x64'), 'macos-x64')
  assert.equal(preparedUnixTarget('win32', 'x64'), undefined)
  assert.throws(() => preparedUnixTarget('linux', 'arm'), /does not provide/)
})
