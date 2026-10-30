// Translated from the tests in VulcanCode `crates/vulcan-markdown-memory/src/timestamp.rs`.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatUtcMinute, isUtcMinute, nowUtcMinute } from './timestamp.js'

test('known instants format to their calendar dates', () => {
  assert.equal(formatUtcMinute(new Date(0)), '1970-01-01T00:00Z')
  assert.equal(formatUtcMinute(new Date(951_782_400_000)), '2000-02-29T00:00Z')
  assert.equal(formatUtcMinute(new Date(1_792_503_240_000)), '2026-10-20T13:34Z')
  assert.ok(isUtcMinute(nowUtcMinute()))
  assert.ok(!isUtcMinute('2026-10-20 13:34Z'))
})
