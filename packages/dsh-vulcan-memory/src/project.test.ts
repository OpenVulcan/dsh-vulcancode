import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'

import { hostProjectId, normalizeRoot, projectContext } from './project.js'

test('a session directory gives a stable host project', () => {
  const root = path.resolve('some', 'repo')
  const context = projectContext(`${root}${path.sep}`)
  assert.equal(context.rootPath, root)
  assert.equal(context.hostProjectId, hostProjectId(root))
  assert.match(context.hostProjectId ?? '', /^dshproject-[0-9a-f]{16}$/)
  assert.deepEqual(projectContext(undefined), {})
  assert.deepEqual(projectContext('  '), {})
})

test('Windows roots hash case-insensitively, others do not', () => {
  assert.equal(hostProjectId('D:\\Work\\App', 'win32'), hostProjectId('d:\\work\\app', 'win32'))
  assert.notEqual(hostProjectId('/work/App', 'linux'), hostProjectId('/work/app', 'linux'))
})

test('a filesystem root keeps its separator', () => {
  const root = path.parse(process.cwd()).root
  assert.equal(normalizeRoot(root), root)
})
