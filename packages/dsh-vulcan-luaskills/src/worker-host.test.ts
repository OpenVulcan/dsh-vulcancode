import assert from 'node:assert/strict'
import { test } from 'node:test'
import { prepareWindowsNode, workerEnvironment } from './worker-host.js'

test('the worker drops all Lua overrides before process startup', () => {
  // Keep the input unchanged and preserve unrelated host variables.
  // 保持输入不变，并保留无关的宿主环境变量。
  const parent = {
    PATH: '/bin', LUA_PATH: 'a', lua_cpath: 'b', LUA_INIT: 'c',
    LUA_PATH_5_1: 'd', luA_INIT_5_4: 'e', LUA_CPATH_5_2: 'f', LUA_OTHER: 'g',
    ELECTRON_RUN_AS_NODE: '0',
  }
  assert.deepEqual(workerEnvironment(parent, false), { PATH: '/bin', LUA_OTHER: 'g' })
  assert.deepEqual(workerEnvironment(parent, true), { PATH: '/bin', LUA_OTHER: 'g', ELECTRON_RUN_AS_NODE: '1' })
  assert.equal(parent.LUA_PATH, 'a')
})

test('the Windows host rejects an unverified executable before reading its resources', async () => {
  await assert.rejects(prepareWindowsNode(Buffer.from('untrusted')), /SHA-256 verification/)
})
