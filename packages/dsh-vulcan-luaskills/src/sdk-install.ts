/**
 * Install the pinned SDK packages into the runtime's own `node_modules`: download each npm
 * tarball, check it against the registry's sha512 integrity, check every archive member stays
 * inside its folder, then unpack it with the system `tar`. No package manager and no install
 * script runs.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import type { PinnedPackage } from './constants.js'

const run = promisify(execFile)

/** Where one package lives below a `node_modules` folder. */
export function packageDir(nodeModules: string, name: string): string {
  return path.join(nodeModules, ...name.split('/'))
}

/**
 * Download one URL whole, reporting bytes as they arrive.
 * @throws when the answer is not 200 or the signal aborts.
 */
export async function download(
  url: string,
  signal: AbortSignal,
  progress: (received: number, total: number | null) => void,
): Promise<Buffer> {
  const response = await fetch(url, { signal })
  if (!response.ok || response.body === null) throw new Error(`download of ${url} failed: HTTP ${response.status}`)
  const header = Number(response.headers.get('content-length'))
  const total = Number.isSafeInteger(header) && header > 0 ? header : null
  const chunks: Uint8Array[] = []
  let received = 0
  progress(0, total)
  for await (const chunk of response.body) {
    chunks.push(chunk)
    received += chunk.byteLength
    progress(received, total)
  }
  return Buffer.concat(chunks)
}

/** @throws when the bytes do not match a `sha512-<base64>` integrity value. */
export function checkIntegrity(bytes: Buffer, integrity: string, name: string): void {
  const expected = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity)?.[1]
  if (expected === undefined) throw new Error(`${name}: unsupported integrity ${integrity}`)
  const actual = createHash('sha512').update(bytes).digest('base64')
  if (actual !== expected) throw new Error(`${name}: the download does not match its published integrity`)
}

/**
 * @throws when an npm tarball member is absolute, climbs out of `package/`, or is a link.
 * npm tarballs hold one top folder (usually `package/`); it is stripped on extraction.
 */
export function checkMembers(listing: string, name: string): void {
  const members = listing.split(/\r?\n/).filter(line => line !== '')
  if (members.length === 0) throw new Error(`${name}: the archive is empty`)
  const top = members[0]!.split('/')[0]
  for (const member of members) {
    const parts = member.split('/')
    if (member.startsWith('/') || /^[A-Za-z]:/.test(member) || member.includes('\\') || parts.includes('..') || parts[0] !== top) {
      throw new Error(`${name}: the archive member ${JSON.stringify(member)} is outside its package folder`)
    }
  }
}

/**
 * Install `packages` below `nodeModules`, each package folder replaced whole.
 * @param progress - bytes of the package downloading now, with its index.
 */
export async function installPackages(
  packages: readonly PinnedPackage[],
  nodeModules: string,
  scratch: string,
  signal: AbortSignal,
  progress: (index: number, received: number, total: number | null) => void,
): Promise<void> {
  await mkdir(scratch, { recursive: true })
  for (const [index, pkg] of packages.entries()) {
    const bytes = await download(pkg.tarball, signal, (received, total) => { progress(index, received, total) })
    checkIntegrity(bytes, pkg.integrity, pkg.name)
    const file = `${pkg.name.replace('/', '__')}-${pkg.version}.tgz`
    await writeFile(path.join(scratch, file), bytes)
    // Run beside the archive with relative names, so a GNU tar on PATH never reads a drive colon as a host.
    const tar = (args: string[]) => run('tar', args, { cwd: scratch, maxBuffer: 64 * 1024 * 1024, signal })
    const { stdout } = await tar(['-tzf', `./${file}`])
    checkMembers(stdout, pkg.name)
    // Symbolic and hard links are refused by listing their types as well.
    const { stdout: verbose } = await tar(['-tvzf', `./${file}`])
    if (verbose.split(/\r?\n/).some(line => /^[lh]/.test(line))) throw new Error(`${pkg.name}: the archive contains links`)
    const target = packageDir(nodeModules, pkg.name)
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })
    const relative = path.relative(scratch, target).split(path.sep).join('/')
    await tar(['-xzf', `./${file}`, '-C', relative, '--strip-components=1'])
  }
}
