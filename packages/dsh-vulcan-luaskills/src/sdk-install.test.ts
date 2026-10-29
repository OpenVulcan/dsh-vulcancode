import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { checkIntegrity, checkMembers, installPackages, packageDir } from './sdk-install.js'

test('archive members must stay inside one package folder', () => {
  assert.doesNotThrow(() => checkMembers('package/package.json\npackage/lib/index.js\n', 'p'))
  for (const listing of ['', 'package/a\n../evil', 'package/a\n/etc/passwd', 'package/a\nC:/x', 'package/a\npackage\\..\\x', 'package/a\nother/b', 'package/../x']) {
    assert.throws(() => { checkMembers(listing, 'p') }, Error, JSON.stringify(listing))
  }
})

test('integrity is checked against sha512 only', () => {
  const bytes = Buffer.from('hello')
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  assert.doesNotThrow(() => { checkIntegrity(bytes, integrity, 'p') })
  assert.throws(() => { checkIntegrity(Buffer.from('other'), integrity, 'p') })
  assert.throws(() => { checkIntegrity(bytes, 'sha1-abc', 'p') })
})

test('scoped packages land below their scope folder', () => {
  assert.equal(packageDir('/nm', '@luaskills/sdk'), path.join('/nm', '@luaskills', 'sdk'))
  assert.equal(packageDir('/nm', 'koffi'), path.join('/nm', 'koffi'))
})

/** Pack `files` as an npm-style tarball below `package/`, with an optional symbolic link. */
function tarball(folder: string, files: Record<string, string>, link?: string): Buffer {
  const source = path.join(folder, 'src')
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(source, 'package', name)), { recursive: true })
    writeFileSync(path.join(source, 'package', name), text)
  }
  if (link !== undefined) symlinkSync('package.json', path.join(source, 'package', link))
  execFileSync('tar', ['-czf', '../pkg.tgz', 'package'], { cwd: source })
  return readFileSync(path.join(folder, 'pkg.tgz'))
}

async function serve(bytes: Buffer): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-length': bytes.length })
    response.end(bytes)
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/pkg.tgz`, close: () => new Promise(resolve => { server.close(() => { resolve() }) }) }
}

test('a downloaded package replaces its folder whole, with byte progress', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'vls-sdk-'))
  const bytes = tarball(folder, { 'package.json': '{"name":"@x/y"}', 'lib/index.js': 'export {}' })
  const host = await serve(bytes)
  try {
    const nodeModules = path.join(folder, 'home', 'sdk', 'node_modules')
    const stale = path.join(packageDir(nodeModules, '@x/y'), 'stale.js')
    mkdirSync(path.dirname(stale), { recursive: true })
    writeFileSync(stale, '')
    const seen: number[] = []
    await installPackages(
      [{ name: '@x/y', version: '1.0.0', tarball: host.url, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }],
      nodeModules,
      path.join(folder, 'home', 'download'),
      new AbortController().signal,
      (_index, received) => { seen.push(received) },
    )
    assert.equal(readFileSync(path.join(packageDir(nodeModules, '@x/y'), 'lib', 'index.js'), 'utf8'), 'export {}')
    assert.equal(existsSync(stale), false)
    assert.equal(seen.at(-1), bytes.length)
  } finally {
    await host.close()
  }
})

test('a package that does not match its integrity is not extracted', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'vls-sdk-'))
  const bytes = tarball(folder, { 'package.json': '{}' })
  const host = await serve(bytes)
  try {
    const nodeModules = path.join(folder, 'nm')
    await assert.rejects(installPackages(
      [{ name: 'p', version: '1.0.0', tarball: host.url, integrity: `sha512-${createHash('sha512').update('other').digest('base64')}` }],
      nodeModules,
      path.join(folder, 'download'),
      new AbortController().signal,
      () => {},
    ))
    assert.equal(existsSync(packageDir(nodeModules, 'p')), false)
  } finally {
    await host.close()
  }
})

test('a package holding a link is refused', async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), 'vls-sdk-'))
  let bytes: Buffer
  try {
    bytes = tarball(folder, { 'package.json': '{}' }, 'alias.json')
  } catch {
    t.skip('this system cannot create symbolic links')
    return
  }
  const host = await serve(bytes)
  try {
    await assert.rejects(installPackages(
      [{ name: 'p', version: '1.0.0', tarball: host.url, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }],
      path.join(folder, 'nm'),
      path.join(folder, 'download'),
      new AbortController().signal,
      () => {},
    ), /links/)
  } finally {
    await host.close()
  }
})
