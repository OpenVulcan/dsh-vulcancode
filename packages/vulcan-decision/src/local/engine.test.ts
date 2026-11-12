import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_OPTIONS, type JudgeInput, type ModelResult } from '../protocol.js'
import type { DecisionHome } from '../home.js'
import { LocalEngine, mergeRequests, splitResults, type LocalSelection } from './engine.js'
import type { LoadResult } from './worker.js'

test('merged calls are split at the package limit and keep their order', () => {
  assert.deepEqual(mergeRequests([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(mergeRequests([1, 2, 3], undefined), [[1, 2, 3]])
  assert.deepEqual(mergeRequests([], 4), [])
})

test('each caller gets back its own slice of the merged results', () => {
  const groups = [['a'], ['b', 'c'], [], ['d']]
  assert.deepEqual(splitResults(groups, [1, 2, 3, 4]), [[1], [2, 3], [], [4]])
})

test('an idle timeout never stops a judgement already using the worker', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const engine = new LocalEngine({} as DecisionHome, 500)
  const selection: LocalSelection = { pack: 'onnx-cpu', model: 'fixture' }
  const input: JudgeInput = { settings: DEFAULT_OPTIONS, rendered: 'fixture' }
  const answer: ModelResult = { decision: 'allow', model_evaluated: true }
  const startSecond = Promise.withResolvers<void>()
  const release = Promise.withResolvers<ModelResult[]>()
  const loaded: LoadResult = { load_seconds: 0, device: 'cpu', format: 'onnx-delivery', root: 'fixture' }
  let calls = 0
  let stops = 0
  const internals = engine as unknown as { worker: unknown; current: unknown }
  internals.worker = {
    running: true,
    async judge() {
      if (calls++ === 0) return [answer]
      startSecond.resolve()
      return release.promise
    },
    async stop() { stops++ },
  }
  internals.current = { key: `${selection.pack}\n${selection.model}`, selection, loading: Promise.resolve(loaded), loaded }
  await engine.judge(selection, [input])
  t.mock.timers.tick(400)
  const second = engine.judge(selection, [input])
  await startSecond.promise
  t.mock.timers.tick(200)
  assert.equal(stops, 0)
  release.resolve([answer])
  assert.deepEqual(await second, [answer])
  t.mock.timers.tick(500)
  assert.equal(stops, 1)
})
