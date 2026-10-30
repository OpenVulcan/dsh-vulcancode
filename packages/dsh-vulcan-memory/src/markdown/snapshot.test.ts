// Translated from the tests in VulcanCode `crates/vulcan-markdown-memory/src/snapshot.rs`.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_BUDGET, type InjectionBudget } from '../settings.js'
import { MemoryDocument } from './document.js'
import { buildInjectionSnapshot, overBudget } from './snapshot.js'
import type { ScopeDocuments } from './store.js'
import { estimateTokens } from './tokens.js'

function documents(user: string, space: string, project?: string): ScopeDocuments {
  return {
    user: MemoryDocument.parse(user),
    space: MemoryDocument.parse(space),
    ...project === undefined ? {} : {
      project: {
        project: { id: 'p-1', name: 'demo', hostProjectIds: [], paths: [], memoryEnabled: true, created: '', updated: '' },
        document: MemoryDocument.parse(project),
      },
    },
  }
}

const BASE = '<!-- mem id=m-b section=base created=2026-10-01T00:00Z updated=2026-10-02T00:00Z source=user -->'

test('base sections are injected in full and other sections as catalogs', () => {
  const space = `# Base\n${BASE}\n## Verify narrowly\nRun targeted tests only.\n# Conventions\n## Commits\nSplit by feature.\n### Message style\nimperative\n`
  const snapshot = buildInjectionSnapshot(documents('# Identity\n## Role\nBackend engineer\n', space), DEFAULT_BUDGET)
  assert.ok(snapshot.content.includes('[user]\n- Identity › Role: Backend engineer'))
  assert.ok(snapshot.content.includes('[space base]\n- Verify narrowly: Run targeted tests only.'))
  assert.ok(snapshot.content.includes('Conventions(2) › Commits [Message style]'))
  assert.ok(snapshot.content.includes('[space catalog · updated 2026-10-02]'))
  assert.ok(!snapshot.content.includes('Split by feature'))
  assert.equal(snapshot.usage.length, 3)
})

test('over-budget full text keeps whole leading entries and names the rest', () => {
  const user = '# Identity\n## First\nshort\n## Second\nlonger text that will not fit in a tiny budget at all\n'
  const budget: InjectionBudget = { ...DEFAULT_BUDGET, user: estimateTokens('- Identity › First: short') + 1 }
  const snapshot = buildInjectionSnapshot(documents(user, ''), budget)
  assert.ok(snapshot.content.includes('- Identity › First: short'))
  assert.ok(snapshot.content.includes('read with memory_search: Identity › Second'))
  assert.ok(overBudget(snapshot.usage[0]!))
  assert.deepEqual(snapshot.usage[0]?.omitted, ['Identity › Second'])
})

test('catalogs degrade from H3 to H2 to section counts', () => {
  const project = '# Architecture\n## Storage\n### Atomic writes\nx\n### Registry\ny\n## Providers\nz\n'
  const render = (tokens: number) => buildInjectionSnapshot(documents('', '', project), { ...DEFAULT_BUDGET, projectCatalog: tokens }).content
  assert.ok(render(1_000).includes('Storage [Atomic writes, Registry] · Providers'))
  const shallow = render(18)
  assert.ok(shallow.includes('Architecture(4) › Storage · Providers'), shallow)
  assert.ok(render(8).includes('Architecture(4)\n(catalog shortened'))
})

test('empty memory injects nothing', () => {
  assert.equal(buildInjectionSnapshot(documents('', '# Base\n\n# Conventions\n'), DEFAULT_BUDGET).content, '')
})
