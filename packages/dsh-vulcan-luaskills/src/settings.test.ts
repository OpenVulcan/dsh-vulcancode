import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { DEFAULT_SETTINGS, engineOptions, loadSettings, parseSettings, saveSettings, SettingsError } from './settings.js'

const copy = () => structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, Record<string, unknown>>

test('the defaults pass their own check', () => {
  assert.deepEqual(parseSettings(structuredClone(DEFAULT_SETTINGS)), DEFAULT_SETTINGS)
})

test('a settings value is refused for any wrong field', () => {
  const cases: [string, (value: Record<string, Record<string, unknown>>) => void][] = [
    ['zero count', value => { value['vmPool']!['minSize'] = 0 }],
    ['fractional count', value => { value['toolCache']!['maxEntries'] = 1.5 }],
    ['missing field', value => { delete value['managedRuntime']!['workerIdleTtlSecs'] }],
    ['extra field', value => { value['network']!['proxy'] = 'http://proxy' }],
    ['pool order', value => { value['runLuaPool']!['minSize'] = 9; value['runLuaPool']!['maxSize'] = 2 }],
    ['cache order', value => { value['toolCache']!['defaultTtlSecs'] = 100; value['toolCache']!['maxTtlSecs'] = 10 }],
    ['unknown encoding', value => { value['capabilities']!['defaultTextEncoding'] = 'utf-16' }],
    ['non-http url', value => { value['network']!['officialSkillHubBaseUrl'] = 'ftp://hub.example' }],
    ['null hub url', value => { value['network']!['officialSkillHubBaseUrl'] = null }],
  ]
  for (const [name, change] of cases) {
    const value = copy()
    change(value)
    assert.throws(() => parseSettings(value), SettingsError, name)
  }
})

test('optional GitHub addresses accept null and an encoding accepts null', () => {
  const value = copy()
  value['network']!['githubBaseUrl'] = null
  value['capabilities']!['defaultTextEncoding'] = null
  assert.doesNotThrow(() => parseSettings(value))
})

test('a damaged settings file is reported, left as it is, and the defaults are used', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'vls-settings-'))
  const file = path.join(folder, 'settings.json')
  assert.equal(loadSettings(file).kind, 'defaults')
  writeFileSync(file, '{"vmPool": 1}')
  const loaded = loadSettings(file)
  assert.equal(loaded.kind, 'invalid')
  assert.deepEqual(loaded.settings, DEFAULT_SETTINGS)
  assert.equal(readFileSync(file, 'utf8'), '{"vmPool": 1}')
})

test('saved settings read back whole', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'vls-settings-')), 'nested', 'settings.json')
  const value = copy()
  value['vmPool']!['maxSize'] = 12
  saveSettings(file, parseSettings(value))
  const loaded = loadSettings(file)
  assert.equal(loaded.kind, 'saved')
  assert.equal(loaded.settings.vmPool.maxSize, 12)
})

test('engine options use the SDK wire names and leave an automatic encoding out', () => {
  const { poolConfig, hostOptions } = engineOptions(DEFAULT_SETTINGS)
  assert.deepEqual(Object.keys(poolConfig).sort(), ['idle_ttl_secs', 'max_size', 'min_size'])
  for (const key of ['runlua_pool_config', 'cache_config', 'managed_runtime_config', 'capabilities', 'official_skill_hub_base_url', 'allow_network_download']) {
    assert.ok(key in hostOptions, key)
  }
  const automatic = { ...DEFAULT_SETTINGS, capabilities: { ...DEFAULT_SETTINGS.capabilities, defaultTextEncoding: null } }
  assert.equal('default_text_encoding' in engineOptions(automatic).hostOptions, false)
  const gbk = { ...DEFAULT_SETTINGS, capabilities: { ...DEFAULT_SETTINGS.capabilities, defaultTextEncoding: 'gbk' as const } }
  assert.equal(engineOptions(gbk).hostOptions['default_text_encoding'], 'gbk')
})
