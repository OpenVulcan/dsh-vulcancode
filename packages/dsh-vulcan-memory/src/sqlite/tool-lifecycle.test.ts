import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { DEFAULT_SETTINGS, saveSettings, SETTINGS_FILE } from '../settings.js'
import { watchSqliteTools } from './tool-lifecycle.js'

test('mode changes register and withdraw tools even without a host activation predicate', async () => {
  // Use only register and dispose to match the DSH 0.2.1 registry contract.
  // 只使用注册和注销，匹配 DSH 0.2.1 的工具注册契约。
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-sqlite-tool-mode-'))
  let active = 0
  let warnings = 0
  const lifecycle = watchSqliteTools(root, () => {
    active++
    return () => { active-- }
  }, () => { warnings++ })
  try {
    assert.equal(active, 0)
    saveSettings(root, { ...DEFAULT_SETTINGS, mode: 'sqlite' })
    lifecycle.refresh()
    lifecycle.refresh()
    assert.equal(active, 1)
    await writeFile(path.join(root, SETTINGS_FILE), '{')
    lifecycle.refresh()
    assert.equal(active, 0)
    assert.equal(warnings, 1)
    saveSettings(root, { ...DEFAULT_SETTINGS, mode: 'sqlite' })
    lifecycle.refresh()
    assert.equal(active, 1)
    saveSettings(root, { ...DEFAULT_SETTINGS, mode: 'off' })
    lifecycle.refresh()
    assert.equal(active, 0)
  } finally {
    lifecycle.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
