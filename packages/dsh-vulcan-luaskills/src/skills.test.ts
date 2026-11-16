import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { installSource, listInstalled, readHubSummary, saveHubSummary, topLevelScalars } from './skills.js'

test('top-level scalars skip nested blocks and strip quotes', () => {
  const values = topLevelScalars('name: "Codekit"\nversion: 1.2.0\nentries:\n  - name: rg\nempty:\n')
  assert.equal(values.get('name'), 'Codekit')
  assert.equal(values.get('version'), '1.2.0')
  assert.equal(values.has('entries'), false)
  assert.equal(values.has('empty'), false)
})

test('the install source is read from its block', () => {
  const record = 'skill_id: x\r\nsource:\r\n  source_type: github\r\n  locator: LuaSkills/x\r\ninstalled_at: 1\r\n'
  assert.deepEqual(installSource(record), { type: 'github', locator: 'LuaSkills/x' })
  assert.equal(installSource('skill_id: x\n'), undefined)
})

test('installed skills come from both layers with their state', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'vls-skills-'))
  const skill = (folder: string, id: string, yaml: string) => {
    mkdirSync(path.join(root, folder, id), { recursive: true })
    writeFileSync(path.join(root, folder, id, 'skill.yaml'), yaml)
  }
  skill('root_skills', 'vulcan-codekit', 'name: codekit\nversion: 0.3.1\nhelp:\n  main:\n    description: >-\n      Inspect source structure\n      and edit functions.\n')
  skill('user_skills', 'notes', 'version: 1.0.0\n')
  mkdirSync(path.join(root, 'user_skills', 'not-a-skill'), { recursive: true })
  mkdirSync(path.join(root, 'state', 'installs'), { recursive: true })
  mkdirSync(path.join(root, 'state', 'skills', 'disabled'), { recursive: true })
  writeFileSync(path.join(root, 'state', 'installs', 'vulcan-codekit.yaml'), 'source:\n  source_type: github\n  locator: LuaSkills/vulcan-codekit\n')
  writeFileSync(path.join(root, 'state', 'skills', 'disabled', 'notes.json'), '{}')

  const skills = listInstalled(root)
  assert.equal(skills.length, 2)
  const codekit = skills.find(item => item.skillId === 'vulcan-codekit')
  const notes = skills.find(item => item.skillId === 'notes')
  assert.deepEqual(codekit, {
    skillId: 'vulcan-codekit', root: 'ROOT', name: 'codekit', version: '0.3.1', enabled: true,
    description: 'Inspect source structure and edit functions.',
    source: { type: 'github', locator: 'LuaSkills/vulcan-codekit' },
  })
  assert.deepEqual(notes, { skillId: 'notes', root: 'USER', name: 'notes', version: '1.0.0', enabled: false })
})

// The Hub introduction remains available after a restart and can be removed on uninstall.
// Hub 介绍重启后仍可读取，卸载时可移除。
test('stores Hub introductions apart from SDK install records', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'vls-hub-info-'))
  assert.equal(readHubSummary(root, 'vulcan-mermaid', '0.1.2'), undefined)
  await saveHubSummary(root, 'vulcan-mermaid', '0.1.2', 'Render offline diagrams.')
  assert.equal(readHubSummary(root, 'vulcan-mermaid', '0.1.2'), 'Render offline diagrams.')
  assert.equal(readHubSummary(root, 'vulcan-mermaid', '0.1.3'), undefined)
  await saveHubSummary(root, 'vulcan-mermaid', '0.1.2', undefined)
  assert.equal(readHubSummary(root, 'vulcan-mermaid', '0.1.2'), undefined)
})

test('a runtime without skill folders lists nothing', () => {
  assert.deepEqual(listInstalled(mkdtempSync(path.join(tmpdir(), 'vls-skills-'))), [])
})
