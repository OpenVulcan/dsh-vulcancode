// Pack the VulcanCode suite as one self-contained tarball: the @openvulcan/dsh-vulcancode bundle
// with every workspace package it reaches (the plugins, the decision engine and the account
// library) inside it as bundled dependencies, so `dsh plugin add` installs a single package and
// never looks one of them up in a registry. pnpm does not install the dependencies of bundled
// packages, so their registry dependencies become the suite's own: the bundled copies resolve them
// from the suite's node_modules. Run after `pnpm -r run build`; writes dist/<name>-<version>.tgz.

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const PACKAGES = path.join(ROOT, 'packages')
const DIST = path.join(ROOT, 'dist')
const STAGE = path.join(DIST, '.stage-dsh-plugin')
const SUITE = 'dsh-vulcancode'

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))

/** Every workspace package by name. */
const workspace = new Map(fs.readdirSync(PACKAGES).flatMap((dir) => {
  const file = path.join(PACKAGES, dir, 'package.json')
  if (!fs.existsSync(file)) return []
  const manifest = readJson(file)
  return [[manifest.name, { dir: path.join(PACKAGES, dir), manifest }]]
}))

/** Resolve `workspace:` ranges to the exact version the workspace holds. */
function resolved(dependencies = {}) {
  return Object.fromEntries(Object.entries(dependencies).map(([name, range]) => {
    if (!range.startsWith('workspace:')) return [name, range]
    const target = workspace.get(name)
    if (target === undefined) throw new Error(`${name} is not a workspace package`)
    return [name, target.manifest.version]
  }))
}

/** The manifest as published: no scripts or development dependencies, exact workspace versions. */
function published(manifest) {
  const { scripts: _scripts, devDependencies: _dev, ...rest } = manifest
  return { ...rest, ...manifest.dependencies === undefined ? {} : { dependencies: resolved(manifest.dependencies) } }
}

/** The files npm would publish for the package in `dir`, as its own `files` list selects them. */
function publishedFiles(dir) {
  const [packed] = JSON.parse(execSync('npm pack --dry-run --json', { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  return packed.files.map(file => file.path).filter(file => file !== 'package.json')
}

/** Copy one package's published files into `to`, with its published manifest and the license. */
function stagePackage({ dir, manifest }, to) {
  if (fs.existsSync(path.join(dir, 'tsconfig.json')) && !fs.existsSync(path.join(dir, 'lib'))) {
    throw new Error(`${manifest.name} is not built; run pnpm -r run build first`)
  }
  for (const file of publishedFiles(dir)) {
    fs.mkdirSync(path.dirname(path.join(to, file)), { recursive: true })
    fs.copyFileSync(path.join(dir, file), path.join(to, file))
  }
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(to, 'LICENSE'))
  return published(manifest)
}

/** The workspace packages `name` reaches through its runtime dependencies, without itself. */
function reach(name, found = new Set()) {
  for (const dependency of Object.keys(workspace.get(name).manifest.dependencies ?? {})) {
    if (!workspace.has(dependency) || found.has(dependency)) continue
    found.add(dependency)
    reach(dependency, found)
  }
  return found
}

const suiteName = `@openvulcan/${SUITE}`
const suite = workspace.get(suiteName)
if (suite === undefined) throw new Error(`no ${suiteName} in packages/`)
const bundled = [...reach(suiteName)].sort()
for (const name of bundled) {
  const version = workspace.get(name).manifest.version
  if (version !== suite.manifest.version) throw new Error(`${name} is at ${version}, the suite at ${suite.manifest.version}; release them together`)
}

/** The registry dependencies of the bundled packages, which the suite installs on their behalf. */
const registry = {}
for (const name of bundled) {
  for (const [dependency, range] of Object.entries(workspace.get(name).manifest.dependencies ?? {})) {
    if (workspace.has(dependency)) continue
    if (registry[dependency] !== undefined && registry[dependency] !== range) {
      throw new Error(`${dependency} is wanted as ${registry[dependency]} and as ${range} (by ${name}); align the ranges`)
    }
    registry[dependency] = range
  }
}

fs.rmSync(STAGE, { recursive: true, force: true })
fs.mkdirSync(STAGE, { recursive: true })

const manifest = stagePackage(suite, STAGE)
if (fs.existsSync(path.join(ROOT, 'README.md'))) fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(STAGE, 'README.md'))
// Everything the suite reaches lives in its node_modules, so every bundled package resolves the others there.
fs.writeFileSync(path.join(STAGE, 'package.json'), `${JSON.stringify({
  ...manifest,
  dependencies: { ...manifest.dependencies, ...registry, ...Object.fromEntries(bundled.map(name => [name, workspace.get(name).manifest.version])) },
  bundleDependencies: bundled,
}, null, 2)}\n`)
for (const name of bundled) {
  const to = path.join(STAGE, 'node_modules', ...name.split('/'))
  fs.mkdirSync(to, { recursive: true })
  fs.writeFileSync(path.join(to, 'package.json'), `${JSON.stringify(stagePackage(workspace.get(name), to), null, 2)}\n`)
}

// One command string: on Windows npm is a .cmd script, which only runs through a shell.
const [packed] = JSON.parse(execSync(`npm pack --json --pack-destination "${DIST}"`, { cwd: STAGE, encoding: 'utf8' }))
fs.rmSync(STAGE, { recursive: true, force: true })
console.log(`${path.join(DIST, packed.filename)} (${(packed.size / 1024).toFixed(0)} KiB, ${packed.entryCount} files, bundles ${bundled.join(', ')})`)
