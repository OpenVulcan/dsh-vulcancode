import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findFenceInfo, scanFences } from './fences.js'

test('recovers the meta of a fence by its language and content', () => {
  const markdown = 'Intro\n\n```ui-chart bar Weekly\nWeek | New\nW1 | 3\n```\n\n```ui-chart line Daily\nDay | New\nD1 | 4\n```\n'
  assert.deepEqual(findFenceInfo(markdown, 'ui-chart', 'Day | New\nD1 | 4\n'), { language: 'ui-chart', meta: 'line Daily' })
  assert.deepEqual(findFenceInfo(markdown, 'ui-chart', 'Week | New\nW1 | 3\n'), { language: 'ui-chart', meta: 'bar Weekly' })
  assert.equal(findFenceInfo(markdown, 'ui-chart', 'Other | 1\n'), undefined)
})

test('finds fences nested in a four-backtick container and inside quotes or list items', () => {
  const markdown = '````ui-details Plan\nGoal.\n\n```ui-checklist Checks\nok | done\n```\n````\n\n> ```ui-kv Facts\n> a | b\n> ```\n\n- item\n\n  ```ui-tree\n  src\n    a.ts\n  ```\n'
  assert.deepEqual(scanFences(markdown).map((fence) => fence.language), ['ui-details', 'ui-checklist', 'ui-kv', 'ui-tree'])
  assert.equal(findFenceInfo(markdown, 'ui-checklist', 'ok | done\n')?.meta, 'Checks')
  assert.equal(findFenceInfo(markdown, 'ui-kv', 'a | b\n')?.meta, 'Facts')
  assert.equal(findFenceInfo(markdown, 'ui-tree', 'src\n  a.ts\n')?.meta, '')
})

test('tilde fences close only on a tilde run at least as long', () => {
  const fences = scanFences('~~~~ui-callout info Note\n```\ninner\n```\n~~~~\n')
  assert.equal(fences[0]?.meta, 'info Note')
  assert.equal(fences[0]?.body, '```\ninner\n```')
})
