import assert from 'node:assert/strict'
import { test } from 'node:test'

import { groupRoutes } from './index.js'

const ok = async (): Promise<unknown> => null

test('routes sharing a path become one registration with every method', () => {
  // dsh's connection rejects a second registration of an exact path, so GET and POST must share one.
  const grouped = groupRoutes([
    ['GET', 'settings', ok],
    ['POST', 'settings', ok],
    ['GET', 'overview', ok],
  ])
  assert.deepEqual([...grouped.keys()], ['settings', 'overview'])
  assert.deepEqual([...(grouped.get('settings')?.keys() ?? [])], ['GET', 'POST'])
})

test('a method declared twice for one path is rejected', () => {
  assert.throws(() => groupRoutes([['GET', 'file', ok], ['GET', 'file', ok]]), /GET file is declared twice/)
})
