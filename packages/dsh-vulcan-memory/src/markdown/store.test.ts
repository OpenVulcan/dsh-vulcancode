// Translated from VulcanCode `crates/vulcan-markdown-memory/src/store.rs` tests and `store_commit_tests.rs`.

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { MarkdownMemoryStore, commitFiles, commitFilesWith, readOptional, retryFileMutation, type PreparedFile } from './store.js'

const temporaryRoot = () => mkdtempSync(path.join(tmpdir(), 'vulcan-memory-'))
const change = (file: string, text: string): PreparedFile => ({ path: file, original: readOptional(file), text })
const denied = () => Object.assign(new Error('denied'), { code: 'EPERM_TEST' })

test('commit checks originals and cleans up', () => {
  const root = temporaryRoot()
  const first = path.join(root, 'a.md')
  const second = path.join(root, 'b.md')
  writeFileSync(second, 'external')
  assert.throws(() => commitFiles([
    { path: first, original: undefined, text: 'new' },
    { path: second, original: 'read earlier', text: 'mine' },
  ]), { kind: 'concurrent_modification' })
  assert.ok(!existsSync(first))
  assert.equal(readFileSync(second, 'utf8'), 'external')
  assert.equal(readdirSync(root).length, 1)

  commitFiles([{ path: first, original: undefined, text: 'new' }])
  assert.equal(readFileSync(first, 'utf8'), 'new')
})

test('project paths reject unsafe ids', () => {
  const store = new MarkdownMemoryStore('root')
  assert.doesNotThrow(() => store.scopePath('project', 'p-1a2b'))
  assert.throws(() => store.scopePath('project', '../x'), { kind: 'invalid' })
  assert.throws(() => store.scopePath('project', undefined), { kind: 'project_unavailable' })
})

test('late failure restores existing and absent originals', () => {
  const root = temporaryRoot()
  const first = path.join(root, 'existing.md')
  const second = path.join(root, 'new.md')
  const last = path.join(root, 'blocked.md')
  writeFileSync(first, 'original\r\n')
  writeFileSync(last, 'untouched')
  assert.throws(() => commitFilesWith(
    [change(first, 'replaced'), change(second, 'created'), change(last, 'blocked')],
    (source, destination) => {
      if (destination === last) throw denied()
      renameSync(source, destination)
    },
  ), { kind: 'io' })
  assert.equal(readFileSync(first, 'utf8'), 'original\r\n')
  assert.ok(!existsSync(second))
  assert.equal(readFileSync(last, 'utf8'), 'untouched')
  assert.equal(readdirSync(root).length, 2)
})

test('incomplete rollback preserves a recovery copy', () => {
  const root = temporaryRoot()
  const first = path.join(root, 'first.md')
  const last = path.join(root, 'blocked.md')
  writeFileSync(first, 'original')
  let error: unknown
  try {
    commitFilesWith([change(first, 'replaced'), change(last, 'blocked')], (source, destination) => {
      if (destination === last || readOptional(destination) === 'replaced') throw denied()
      renameSync(source, destination)
    })
  } catch (caught) {
    error = caught
  }
  assert.equal((error as { kind?: string }).kind, 'rollback_incomplete')
  const message = (error as Error).message
  assert.ok(message.includes(JSON.stringify([first])))
  const recovery = readdirSync(root).filter(name => name.endsWith('.tmp'))
  assert.equal(recovery.length, 1)
  assert.equal(readFileSync(path.join(root, recovery[0]!), 'utf8'), 'original')
  assert.equal(readFileSync(first, 'utf8'), 'replaced')
  assert.ok(!existsSync(last))
})

test('rollback does not overwrite an external edit', () => {
  const root = temporaryRoot()
  const first = path.join(root, 'first.md')
  const last = path.join(root, 'blocked.md')
  writeFileSync(first, 'original')
  assert.throws(() => commitFilesWith([change(first, 'replaced'), change(last, 'blocked')], (source, destination) => {
    if (destination === last) {
      writeFileSync(first, 'external')
      throw denied()
    }
    renameSync(source, destination)
  }), { kind: 'rollback_incomplete' })
  assert.equal(readFileSync(first, 'utf8'), 'external')
})

// The Rust test races two threads; synchronous JS cannot interleave within a process, so the
// second editor always sees the first save and is refused for its stale starting text.
test('a whole-file edit from stale text is refused', () => {
  const store = new MarkdownMemoryStore(temporaryRoot())
  const original = 'old\n'.repeat(32768)
  store.replaceFileText('user', undefined, '', original)
  store.replaceFileText('user', undefined, original, 'first\n'.repeat(32768))
  assert.throws(() => store.replaceFileText('user', undefined, original, 'second\n'.repeat(32768)), { kind: 'concurrent_modification' })
  assert.equal(store.readFileText('user', undefined), 'first\n'.repeat(32768))
})

test('windows replacement retry is bounded', { skip: process.platform !== 'win32' }, () => {
  let attempts = 0
  assert.throws(() => retryFileMutation(() => {
    attempts += 1
    throw Object.assign(new Error('busy'), { code: 'EBUSY' })
  }))
  assert.equal(attempts, 5)
  attempts = 0
  retryFileMutation(() => {
    attempts += 1
    if (attempts < 5) throw Object.assign(new Error('denied'), { code: 'EPERM' })
  })
  assert.equal(attempts, 5)
})
