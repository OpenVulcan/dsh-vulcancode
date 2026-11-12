import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'

import { LuaSkillsRuntime, PINNED, type Versions } from './runtime.js'

/** The worker operations the lifecycle tests control without starting a native process.
 *  生命周期测试控制的 worker 操作，无须启动原生进程。 */
interface ControlledWorker {
  start(): Promise<void>
  stop(): Promise<void>
}

/** Create an installed runtime with controlled worker startup and teardown.
 *  创建已安装的运行库，并控制 worker 的启动和停止。 */
function fixture(context: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), 'dsh-luaskills-test-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const runtime = new LuaSkillsRuntime(directory, () => {})
  const controlled = runtime as unknown as {
    state: { kind: 'ready' }
    worker: ControlledWorker | undefined
    readMarker(): Versions
    spawn(): ControlledWorker
  }
  controlled.readMarker = () => PINNED
  return { runtime, controlled }
}

test('close waits for a restart already stopping its worker and prevents another spawn', async context => {
  const { runtime, controlled } = fixture(context)
  const stopping = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let spawnCount = 0
  controlled.state = { kind: 'ready' }
  controlled.worker = {
    start: async () => {},
    stop: async () => {
      stopping.resolve()
      await release.promise
    },
  }
  controlled.spawn = () => {
    spawnCount += 1
    throw new Error('close must prevent a new worker from starting')
  }
  const restart = runtime.restart()
  await stopping.promise
  await assert.rejects(runtime.restart(), { code: 'busy' })
  await assert.rejects(runtime.remove(), { code: 'busy' })
  await assert.rejects(runtime.saveSettings({}), { code: 'busy' })
  assert.throws(() => runtime.install(), { code: 'busy' })
  let closed = false
  const close = runtime.close().then(() => { closed = true })
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(closed, false)
  release.resolve()
  await Promise.all([restart, close, runtime.close()])
  assert.equal(spawnCount, 0)
  assert.throws(() => runtime.engine(), { code: 'not_ready' })
  await assert.rejects(runtime.restart(), { code: 'not_ready' })
})

test('close cancels startup and waits for the only spawned worker to stop', async context => {
  const { runtime, controlled } = fixture(context)
  const starting = Promise.withResolvers<void>()
  const startup = Promise.withResolvers<void>()
  let stopCount = 0
  controlled.spawn = () => {
    const worker: ControlledWorker = {
      start: () => {
        starting.resolve()
        return startup.promise
      },
      stop: async () => {
        stopCount += 1
        startup.reject(new Error('worker stopped'))
      },
    }
    controlled.worker = worker
    return worker
  }
  const restart = runtime.restart()
  await starting.promise
  await assert.rejects(runtime.restart(), { code: 'busy' })
  await Promise.all([restart, runtime.close()])
  assert.equal(stopCount, 1)
  assert.equal(controlled.worker, undefined)
})

test('cancelling installation before it starts leaves the runtime absent', async context => {
  const { runtime } = fixture(context)
  runtime.install()
  runtime.cancel()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(runtime.current, { kind: 'absent' })
  await runtime.close()
})
