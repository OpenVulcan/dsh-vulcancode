import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'

import { LuaSkillsRuntime, PINNED } from './runtime.js'
import { DEFAULT_SETTINGS } from './settings.js'
import type { ManagedKind, ManagedView } from './protocol.js'

/** Return a managed environment with explicitly selected missing interpreters.
 * 返回指定缺失项的受管环境数据。 */
function managedFixture(runtimeRoot: string, missing: readonly ManagedKind[] = []): ManagedView {
  return {
    root: path.join(runtimeRoot, 'dependencies', 'runtimes'),
    node: { version: '24.18.0', packageManagerVersion: '11.11.0', executable: missing.includes('node') ? null : path.join(runtimeRoot, 'node') },
    python: { version: '3.14.6', packageManagerVersion: '0.11.28', executable: missing.includes('python') ? null : path.join(runtimeRoot, 'python') },
  }
}

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
    spawn(): ControlledWorker
  }
  const marker = { ...PINNED, platform: `${process.platform}-${process.arch}`, installedAt: '2026-11-13T00:00:00.000Z' }
  writeFileSync(path.join(directory, 'installed.json'), JSON.stringify(marker))
  Object.assign(controlled, { active: marker })
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

/** Create the legacy files and a controlled worker pair for testing a real on-disk upgrade.
 *  创建旧版文件和可控的新旧进程，测试真实磁盘上的升级流程。 */
function upgradeFixture(context: TestContext) {
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-luaskills-upgrade-'))
  const oldRoot = path.join(home, 'runtime')
  const markerFile = path.join(home, 'installed.json')
  const marker = { sdk: '0.6.7', luaskills: 'v0.7.2', luaRuntime: 'v0.1.8', platform: `${process.platform}-${process.arch}`, installedAt: '2026-11-13T00:00:00.000Z' }
  const skill = { skill_id: 'custom-skill', root_name: 'USER' }
  const legacyFiles = new Map([
    ['root_skills/vulcan-codekit/skill.yaml', 'name: CodeKit\nversion: 0.2.7\n'],
    ['user_skills/custom-skill/skill.yaml', 'name: Custom\nversion: 1.0.0\n'],
    ['project_skills/project-skill/skill.yaml', 'name: Project\nversion: 1.0.0\n'],
    ['state/installs/custom-skill.yaml', 'source:\n  source_type: github\n  locator: owner/custom\n'],
    ['state/skills/disabled/vulcan-codekit.json', '{"reason":"disabled"}'],
    ['config/skills/config.json', '{"retained":true}'],
    ['databases/custom.sqlite', 'database fixture'],
    ['dependencies/tools/custom/v1/tool', 'skill dependency'],
    ['dependencies/envs/old-env', 'path-bound environment'],
    ['state/install_tmp/partial', 'unfinished install'],
    ['libs/old-core', 'legacy native library'],
  ])
  for (const [relative, contents] of legacyFiles) {
    const file = path.join(oldRoot, relative)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, contents)
  }
  const originalMarker = JSON.stringify(marker)
  const settings = JSON.stringify({ ...DEFAULT_SETTINGS, vmPool: { ...DEFAULT_SETTINGS.vmPool, idleTtlSecs: 75 } })
  writeFileSync(markerFile, originalMarker)
  writeFileSync(path.join(home, 'settings.json'), settings)
  const runtime = new LuaSkillsRuntime(home, () => {})
  context.after(async () => {
    await runtime.close()
    rmSync(home, { recursive: true, force: true })
  })
  const candidate = {
    onDownload: undefined,
    pid: undefined,
    async installRuntime({ runtimeRoot }: { runtimeRoot: string }) {
      mkdirSync(path.join(runtimeRoot, 'libs'), { recursive: true })
      writeFileSync(path.join(runtimeRoot, 'libs', 'new-core'), 'new native library')
    },
    async start() {},
    // Supply an already installed environment to lifecycle tests that only exercise migration.
    // 仅测试迁移的生命周期测试使用已安装的解释器环境。
    async inspectManaged(runtimeRoot: string) { return managedFixture(runtimeRoot) },
    async installManaged(_root: string, _version: string, _kind: ManagedKind) {
      throw new Error('a ready runtime must not be reinstalled')
    },
    async help() { return [skill] },
    async install() { throw new Error('the preserved default skill must not be reinstalled') },
    async stop() {},
    async kill() {},
  }
  const legacy = {
    async start() {},
    async help() { return [skill] },
    async stop() {},
  }
  const controlled = runtime as unknown as {
    installSdk(directory: string): Promise<void>
    createWorker(directory: string): typeof candidate | typeof legacy
    operation?: { result: Promise<void> }
  }
  controlled.installSdk = async () => {}
  controlled.createWorker = directory => directory === home ? legacy : candidate
  return { home, oldRoot, markerFile, originalMarker, settings, legacyFiles, runtime, controlled, candidate, legacy }
}

test('upgrade only provisions the missing managed runtime and keeps Lua usable if it fails', async context => {
  const { runtime, candidate, controlled } = upgradeFixture(context)
  // Only Python is missing. Node must never be handed to the installer.
  // 只有 Python 缺失，安装器不应收到 Node 安装请求。
  const calls: ManagedKind[] = []
  candidate.inspectManaged = async root => managedFixture(root, ['python'])
  candidate.installManaged = async (_root, _version, kind) => {
    calls.push(kind)
    throw new Error('test Python download failed')
  }
  await runtime.boot()
  runtime.install()
  await controlled.operation?.result
  assert.deepEqual(calls, ['python'])
  assert.equal(runtime.current.kind, 'ready')
  assert.match(runtime.view().managed?.python.error ?? '', /test Python download failed/)
  assert.ok(runtime.view().managed?.node.executable)
})

test('upgrade commits the validated runtime and preserves skills, configuration and state', async context => {
  const { runtime, controlled, markerFile, originalMarker, home, oldRoot, settings, legacyFiles, candidate } = upgradeFixture(context)
  await runtime.boot()
  assert.equal(runtime.view().installed?.luaskills, 'v0.7.2')
  runtime.install()
  const operation = controlled.operation
  assert.ok(operation)
  await operation.result
  assert.equal(runtime.current.kind, 'ready')
  assert.deepEqual(runtime.view().installed?.luaskills, 'v0.9.0')
  const committed = JSON.parse(readFileSync(markerFile, 'utf8')) as { slot: string }
  assert.match(committed.slot, /^install-/)
  assert.equal(runtime.runtimeRoot, path.join(home, 'versions', committed.slot, 'runtime'))
  assert.equal(readFileSync(path.join(home, 'settings.json'), 'utf8'), settings)
  for (const [relative, contents] of legacyFiles) {
    assert.equal(readFileSync(path.join(oldRoot, relative), 'utf8'), contents)
    if (/^(libs\/|dependencies\/envs\/|state\/install_tmp\/)/.test(relative)) {
      assert.throws(() => readFileSync(path.join(runtime.runtimeRoot, relative)), { code: 'ENOENT' })
    } else {
      assert.equal(readFileSync(path.join(runtime.runtimeRoot, relative), 'utf8'), contents)
    }
  }
  assert.equal(readFileSync(path.join(runtime.runtimeRoot, 'libs', 'new-core'), 'utf8'), 'new native library')
  assert.notEqual(readFileSync(markerFile, 'utf8'), originalMarker)
  assert.equal(await runtime.useEngine(async worker => worker), candidate)
  await runtime.close()
  const restarted = new LuaSkillsRuntime(home, () => {})
  const reopened = restarted as unknown as { createWorker(directory: string): typeof candidate }
  reopened.createWorker = () => candidate
  context.after(() => restarted.close())
  await restarted.boot()
  assert.equal(restarted.current.kind, 'ready')
  assert.equal(restarted.runtimeRoot, runtime.runtimeRoot)
  assert.equal(restarted.settings.vmPool.idleTtlSecs, 75)
})

for (const reason of ['failure', 'cancel', 'missing-skill'] as const) {
  test(`an upgrade rolls back the running legacy installation after ${reason}`, async context => {
    const { runtime, controlled, home, markerFile, originalMarker, oldRoot, candidate, legacy } = upgradeFixture(context)
    const starting = Promise.withResolvers<void>()
    const startup = Promise.withResolvers<void>()
    let oldStarts = 0
    legacy.start = async () => { oldStarts++ }
    if (reason === 'missing-skill') candidate.help = async () => []
    else {
      candidate.start = () => { starting.resolve(); return startup.promise }
      candidate.kill = async () => { startup.reject(new Error('candidate killed')) }
    }
    await runtime.boot()
    runtime.install()
    const operation = controlled.operation
    assert.ok(operation)
    if (reason !== 'missing-skill') {
      await starting.promise
      if (reason === 'cancel') runtime.cancel()
      else startup.reject(new Error('candidate startup failed'))
    }
    await operation.result
    assert.equal(runtime.current.kind, 'ready')
    assert.equal(runtime.view().installed?.luaskills, 'v0.7.2')
    assert.equal(runtime.runtimeRoot, oldRoot)
    assert.equal(await runtime.useEngine(async worker => worker), legacy)
    assert.equal(readFileSync(markerFile, 'utf8'), originalMarker)
    assert.equal(oldStarts, 2)
    assert.deepEqual(readdirSync(path.join(home, 'versions')), [])
    assert.equal(runtime.view().upgradeError === undefined, reason === 'cancel')
  })
}

test('another DSH instance cannot run an old skill after the active marker is replaced', async context => {
  const { home, runtime, controlled, legacy } = upgradeFixture(context)
  const other = new LuaSkillsRuntime(home, () => {})
  const otherWorker = { ...legacy }
  const otherControlled = other as unknown as { createWorker(): typeof otherWorker }
  otherControlled.createWorker = () => otherWorker
  context.after(() => other.close())
  await runtime.boot()
  await other.boot()
  assert.equal(await other.useEngine(async worker => worker), otherWorker)
  runtime.install()
  const operation = controlled.operation
  assert.ok(operation)
  await operation.result
  await assert.rejects(other.useEngine(async () => assert.fail('stale worker was called')), /installation changed/)
  await assert.rejects(other.remove(), /installation changed/)
  assert.equal(runtime.current.kind, 'ready')
})
