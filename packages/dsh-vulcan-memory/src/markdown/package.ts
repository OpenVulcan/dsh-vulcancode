/**
 * Export packages and their node-level import (`package.rs`): export builds a versioned zip, import
 * previews the merge of every scope against the local files and applies it atomically once every
 * packaged project has a target and every conflict a resolution. The page moves the archive bytes
 * through the browser, so these functions take and return bytes instead of native paths; the
 * archive format is VulcanCode's, and packages move between the two in both directions.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { unzipSync, zipSync } from 'fflate'

import { EXPORT_FORMAT_VERSION, MAX_FILE_BYTES, MAX_NODE_LEVEL, MAX_PACKAGE_BYTES, MAX_PACKAGE_PROJECTS, byteLength } from './constants.js'
import { MemoryDocument, storedBody, viewTitle, type NodeView } from './document.js'
import { MemoryError } from './errors.js'
import { REGISTRY_FILE, compare, directoryName, isRecord, randomHex, type MemoryRegistry } from './registry.js'
import { isScope, type MemoryScope } from './scope.js'
import { commitFiles, readOptional, type MarkdownMemoryStore, type PreparedFile } from './store.js'
import { nowUtcMinute } from './timestamp.js'

const PACKAGE_FORMAT = 'vulcan-markdown-memory'
const MANIFEST_ENTRY = 'manifest.json'
const USER_ENTRY = 'user.md'
const SPACE_ENTRY = 'space.md'
const PROJECT_ENTRY_PREFIX = 'projects/'
/** Directory under the Markdown memory directory that keeps the files replaced by imports. */
const BACKUP_DIRECTORY = 'backups'

export interface ExportSelection {
  readonly user: boolean
  readonly space: boolean
  readonly memoryProjectIds: readonly string[]
}

export interface ExportedPackage {
  /** Suggested download name, as VulcanCode names the file it writes. */
  readonly fileName: string
  readonly bytes: Uint8Array
  readonly sha256: string
}

/** One project recorded in a package manifest. */
export interface PackageProject {
  /** Memory project id on the exporting machine; names the project entry. */
  readonly id: string
  readonly name: string
  /** Root paths the project was opened from, as a matching hint. */
  readonly paths: readonly string[]
  readonly firstCommit?: string
}

interface PackageManifest {
  readonly format: string
  readonly version: number
  readonly exportedAt: string
  readonly user: boolean
  readonly space: boolean
  readonly projects: readonly PackageProject[]
}

/** A read and validated package. */
interface Package {
  readonly sha256: string
  readonly manifest: PackageManifest
  readonly user: string | undefined
  readonly space: string | undefined
  /** Project scope texts by packaged project id. */
  readonly projects: ReadonlyMap<string, string>
}

export type ProjectTarget =
  | { readonly action: 'link'; readonly memoryProjectId: string }
  | { readonly action: 'create' }
  | { readonly action: 'ignore' }

export interface ProjectMapping {
  readonly packageProjectId: string
  readonly target: ProjectTarget
}

export type ConflictChoice = 'keep_local' | 'take_imported' | 'keep_both'

export interface ConflictResolution {
  readonly scope: MemoryScope
  readonly packageProjectId?: string
  readonly nodeId: string
  readonly choice: ConflictChoice
}

/** A local memory project suggested for a packaged project, with stable reason keys. */
export interface ProjectCandidate {
  readonly memoryProjectId: string
  readonly name: string
  readonly reasons: readonly ('same_path' | 'same_first_commit' | 'same_directory_name')[]
}

export interface PackageProjectPreview {
  readonly project: PackageProject
  /** Suggested local projects, best first; only hints, nothing is preselected. */
  readonly candidates: readonly ProjectCandidate[]
}

export interface NodeSummary {
  readonly id: string
  readonly path: readonly string[]
}

export interface NodeSide {
  readonly title: string
  readonly body: string
  readonly updated: string | null
}

export type NewerSide = 'local' | 'imported' | 'unknown'

/** A node present on both sides with different content. */
export interface NodeConflict {
  /** Packaged node id, used by the resolution. */
  readonly id: string
  /** Local title path. */
  readonly path: readonly string[]
  readonly local: NodeSide
  readonly imported: NodeSide
  /** Which side is newer; the suggested default. */
  readonly newer: NewerSide
}

export interface ScopeMergePreview {
  readonly scope: MemoryScope
  readonly packageProjectId: string | null
  /** Local memory project merged into; `null` when a new project is created. */
  readonly memoryProjectId: string | null
  readonly same: number
  readonly added: readonly NodeSummary[]
  /** Added nodes whose title path already exists locally under another id; both are kept. */
  readonly duplicates: readonly NodeSummary[]
  readonly conflicts: readonly NodeConflict[]
  /** Titles of the top-level sections the import creates. */
  readonly newSections: readonly string[]
}

/** The preview of an import, bound to the exact archive bytes by their SHA-256. */
export interface ImportPreview {
  readonly sha256: string
  readonly exportedAt: string
  readonly projects: readonly PackageProjectPreview[]
  readonly scopes: readonly ScopeMergePreview[]
}

export interface ImportReport {
  /** Directory holding the replaced files; `null` when no existing file changed. */
  readonly backupDirectory: string | null
  /** Nodes added, including duplicates and kept-both copies. */
  readonly added: number
  readonly replaced: number
  /** Identical nodes and conflicts that kept the local side. */
  readonly unchanged: number
  readonly createdProjects: readonly string[]
}

interface MergeOutcome {
  readonly document: MemoryDocument
  same: number
  readonly added: NodeSummary[]
  readonly duplicates: NodeSummary[]
  readonly conflicts: NodeConflict[]
  readonly newSections: string[]
  /** Conflicts that took the imported side. */
  replaced: number
  /** Conflicts that kept both sides. */
  keptBoth: number
}

interface PlannedScope {
  readonly scope: MemoryScope
  readonly packageProjectId: string | undefined
  /** Local memory project; `undefined` while a created project has no id yet. */
  memoryProjectId: string | undefined
  readonly text: string
}

/** Build an export package of the selected scopes. */
export function exportPackage(store: MarkdownMemoryStore, selection: ExportSelection): ExportedPackage {
  if (!selection.user && !selection.space && selection.memoryProjectIds.length === 0) {
    throw MemoryError.invalid('Choose at least one scope or project to export.')
  }
  if (selection.memoryProjectIds.length > MAX_PACKAGE_PROJECTS) {
    throw MemoryError.invalid(`A package can hold at most ${MAX_PACKAGE_PROJECTS} projects.`)
  }
  const registry = store.registry()
  const projects: PackageProject[] = []
  const entries: [string, string][] = []
  for (const id of [...new Set(selection.memoryProjectIds)].sort(compare)) {
    const project = registry.project(id)
    if (project === undefined) throw MemoryError.invalid(`Memory project \`${id}\` does not exist.`)
    projects.push({
      id: project.id,
      name: project.name,
      paths: [...project.paths],
      ...project.firstCommit === undefined ? {} : { firstCommit: project.firstCommit },
    })
    entries.push([`${PROJECT_ENTRY_PREFIX}${id}.md`, store.readFileText('project', id)])
  }
  if (selection.user) entries.push([USER_ENTRY, store.readFileText('user', undefined)])
  if (selection.space) entries.push([SPACE_ENTRY, store.readFileText('space', undefined)])
  const now = nowUtcMinute()
  const manifest: PackageManifest = {
    format: PACKAGE_FORMAT,
    version: EXPORT_FORMAT_VERSION,
    exportedAt: now,
    user: selection.user,
    space: selection.space,
    projects,
  }
  const bytes = writeArchive(JSON.stringify(manifest, null, 2), entries)
  return { fileName: `vulcan-memory-${fileStamp(now)}-${randomHex(6)}.zip`, bytes, sha256: sha256(bytes) }
}

/** Preview importing a package; mapped projects are compared with their targets, unmapped ones only listed. */
export function previewImport(store: MarkdownMemoryStore, archive: Uint8Array, name: string, mappings: readonly ProjectMapping[]): ImportPreview {
  const pkg = readPackage(archive, name)
  const registry = store.registry()
  const table = mappingTable(pkg, registry, mappings, false)
  const scopes: ScopeMergePreview[] = []
  for (const planned of plannedScopes(pkg, table)) {
    const local = planned.scope === 'project' && planned.memoryProjectId === undefined
      ? MemoryDocument.empty()
      : store.load(planned.scope, planned.memoryProjectId)
    const outcome = merge(local, MemoryDocument.parse(planned.text), planned.scope, () => undefined)
    scopes.push({
      scope: planned.scope,
      packageProjectId: planned.packageProjectId ?? null,
      memoryProjectId: planned.memoryProjectId ?? null,
      same: outcome.same,
      added: outcome.added,
      duplicates: outcome.duplicates,
      conflicts: outcome.conflicts,
      newSections: outcome.newSections,
    })
  }
  return {
    sha256: pkg.sha256,
    exportedAt: pkg.manifest.exportedAt,
    projects: pkg.manifest.projects.map(project => ({ project, candidates: projectCandidates(project, registry) })),
    scopes,
  }
}

/**
 * Apply a previewed import: the archive must still have the previewed SHA-256, every packaged
 * project needs a mapping and every conflict a resolution. Replaced files are backed up first,
 * then every file and the registry are committed as one batch.
 */
export function applyImport(
  store: MarkdownMemoryStore,
  archive: Uint8Array,
  name: string,
  expectedSha256: string,
  mappings: readonly ProjectMapping[],
  resolutions: readonly ConflictResolution[],
): ImportReport {
  const pkg = readPackage(archive, name)
  if (pkg.sha256 !== expectedSha256) throw MemoryError.invalid('The package changed since it was previewed; preview it again.')
  const registry = store.registry()
  const table = mappingTable(pkg, registry, mappings, true)
  const choices = new Map<string, ConflictChoice>()
  for (const resolution of resolutions) {
    const key = conflictKey(resolution.scope, resolution.packageProjectId, resolution.nodeId)
    if (choices.has(key)) throw MemoryError.invalid(`Conflict \`${resolution.nodeId}\` is resolved more than once.`)
    choices.set(key, resolution.choice)
  }
  const now = nowUtcMinute()
  const documents = new Map<string, { original: string | undefined; document: MemoryDocument }>()
  let added = 0
  let replaced = 0
  let unchanged = 0
  const createdProjects: string[] = []
  let resolved = 0
  for (const planned of plannedScopes(pkg, table)) {
    if (planned.scope === 'project' && planned.memoryProjectId === undefined) {
      const project = pkg.manifest.projects.find(candidate => candidate.id === planned.packageProjectId)
      if (project === undefined) throw new Error('planned projects come from the manifest')
      const id = registry.createUnbound(project.name, [...project.paths], project.firstCommit, now)
      createdProjects.push(id)
      planned.memoryProjectId = id
    }
    const file = store.scopePath(planned.scope, planned.memoryProjectId)
    let entry = documents.get(file)
    if (entry === undefined) {
      const original = readOptional(file)
      entry = { original, document: original === undefined ? MemoryDocument.empty() : MemoryDocument.parse(original) }
      documents.set(file, entry)
    }
    const outcome = merge(entry.document, MemoryDocument.parse(planned.text), planned.scope,
      nodeId => choices.get(conflictKey(planned.scope, planned.packageProjectId, nodeId)))
    const missing = outcome.conflicts.find(conflict => !choices.has(conflictKey(planned.scope, planned.packageProjectId, conflict.id)))
    if (missing !== undefined) throw MemoryError.invalid(`Conflict \`${missing.id}\` (${missing.path.join(' > ')}) has no resolution.`)
    resolved += outcome.conflicts.length
    added += outcome.added.length + outcome.keptBoth
    replaced += outcome.replaced
    unchanged += outcome.same + outcome.conflicts.length - outcome.replaced - outcome.keptBoth
    if (changed(outcome)) entry.document = outcome.document
  }
  if (resolved !== choices.size) throw MemoryError.invalid('A resolution names a conflict this import does not have; preview it again.')
  const files: PreparedFile[] = []
  for (const [file, { original, document }] of documents) {
    const text = document.render()
    if (original === text || (original === undefined && text === '')) continue
    if (byteLength(text) > MAX_FILE_BYTES) {
      throw MemoryError.invalid(`\`${file}\` would grow to ${byteLength(text)} bytes, above the ${MAX_FILE_BYTES}-byte limit.`)
    }
    files.push({ path: file, original, text })
  }
  if (createdProjects.length > 0) {
    const file = path.join(store.markdownDirectory, REGISTRY_FILE)
    files.push({ path: file, original: readOptional(file), text: `${registry.toJson()}\n` })
  }
  const backupDirectory = backUp(store, files, now)
  commitFiles(files)
  return { backupDirectory, added, replaced, unchanged, createdProjects }
}

/** Copy every existing file a commit replaces into a new backup directory. */
function backUp(store: MarkdownMemoryStore, files: readonly PreparedFile[], now: string): string | null {
  const replacedFiles = files.filter(file => file.original !== undefined)
  if (replacedFiles.length === 0) return null
  const markdown = store.markdownDirectory
  const directory = path.join(markdown, BACKUP_DIRECTORY, `import-${fileStamp(now)}-${randomHex(6)}`)
  for (const file of replacedFiles) {
    const target = path.join(directory, path.relative(markdown, file.path))
    try {
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, file.original ?? '')
    } catch (error) {
      throw MemoryError.io(target, 'written', error)
    }
  }
  return directory
}

function changed(outcome: MergeOutcome): boolean {
  return outcome.added.length > 0 || outcome.replaced > 0 || outcome.keptBoth > 0
}

/** Key of one conflict across all scopes of an import. */
function conflictKey(scope: MemoryScope, packageProjectId: string | undefined, nodeId: string): string {
  return `${scope}\u001f${packageProjectId ?? ''}\u001f${nodeId}`
}

/** Validate mappings against the package and the registry; `complete` requires one for every packaged project. */
function mappingTable(pkg: Package, registry: MemoryRegistry, mappings: readonly ProjectMapping[], complete: boolean): Map<string, ProjectTarget> {
  const table = new Map<string, ProjectTarget>()
  for (const mapping of mappings) {
    if (!pkg.projects.has(mapping.packageProjectId)) throw MemoryError.invalid(`The package has no project \`${mapping.packageProjectId}\`.`)
    if (mapping.target.action === 'link' && registry.project(mapping.target.memoryProjectId) === undefined) {
      throw MemoryError.invalid(`Memory project \`${mapping.target.memoryProjectId}\` does not exist.`)
    }
    if (table.has(mapping.packageProjectId)) throw MemoryError.invalid(`Project \`${mapping.packageProjectId}\` is mapped more than once.`)
    table.set(mapping.packageProjectId, mapping.target)
  }
  if (complete) {
    const missing = [...pkg.projects.keys()].sort(compare).find(id => !table.has(id))
    if (missing !== undefined) throw MemoryError.invalid(`Choose where packaged project \`${missing}\` goes before importing.`)
  }
  return table
}

/** The scope files an import touches: user, space, then every linked or created project. */
function plannedScopes(pkg: Package, mappings: ReadonlyMap<string, ProjectTarget>): PlannedScope[] {
  const planned: PlannedScope[] = []
  for (const [scope, text] of [['user', pkg.user], ['space', pkg.space]] as const) {
    if (text !== undefined) planned.push({ scope, packageProjectId: undefined, memoryProjectId: undefined, text })
  }
  for (const project of pkg.manifest.projects) {
    const target = mappings.get(project.id)
    if (target === undefined || target.action === 'ignore') continue
    const text = pkg.projects.get(project.id)
    if (text === undefined) throw new Error('every manifest project has a file')
    planned.push({
      scope: 'project',
      packageProjectId: project.id,
      memoryProjectId: target.action === 'link' ? target.memoryProjectId : undefined,
      text,
    })
  }
  return planned
}

/** Rank local memory projects that look like a packaged project. */
function projectCandidates(project: PackageProject, registry: MemoryRegistry): ProjectCandidate[] {
  const names = new Set(project.paths.map(item => directoryName(item).toLowerCase()))
  const candidates: ProjectCandidate[] = []
  for (const local of registry.projects) {
    const reasons: ProjectCandidate['reasons'][number][] = []
    if (local.paths.some(item => project.paths.includes(item))) reasons.push('same_path')
    if (project.firstCommit !== undefined && local.firstCommit === project.firstCommit) reasons.push('same_first_commit')
    if (local.paths.some(item => names.has(directoryName(item).toLowerCase()))) reasons.push('same_directory_name')
    if (reasons.length > 0) candidates.push({ memoryProjectId: local.id, name: local.name, reasons })
  }
  return candidates.sort((left, right) => right.reasons.length - left.reasons.length || compare(left.name, right.name))
}

/**
 * Merge an imported document into a local one node by node. Top-level sections match by section
 * key, other nodes by id; identical nodes are skipped, missing nodes are appended under their
 * matched parent, and conflicts follow `choose` (unresolved conflicts keep the local side).
 */
function merge(local: MemoryDocument, imported: MemoryDocument, scope: MemoryScope, choose: (nodeId: string) => ConflictChoice | undefined): MergeOutcome {
  const outcome: MergeOutcome = {
    // Rendering reproduces the source bytes, so parsing them again is a deep copy.
    document: MemoryDocument.parse(local.render()),
    same: 0,
    added: [],
    duplicates: [],
    conflicts: [],
    newSections: [],
    replaced: 0,
    keptBoth: 0,
  }
  const eol = local.eol
  const importedViews = imported.views(scope)
  const importedIds = new Map(importedViews.map(view => [view.locator.join('/'), view.id]))
  // Imported node id → locator of its node in the merged document. Merging only appends, so
  // recorded locators stay valid.
  const placed = new Map<string, readonly number[]>()
  for (const view of importedViews) {
    const node = imported.node(view.locator)
    if (node === undefined) throw new Error('views come from this document')
    const mergedViews = outcome.document.views(scope)
    const found = matchingView(mergedViews, view)
    if (found !== undefined) {
      placed.set(view.id, found.locator)
      const title = viewTitle(view)
      const localTitle = viewTitle(found)
      if (localTitle.trim() === title.trim() && found.body === view.body) {
        outcome.same += 1
        continue
      }
      const localUpdated = found.meta?.updated ?? null
      const importedUpdated = view.meta?.updated ?? null
      outcome.conflicts.push({
        id: view.id,
        path: found.path,
        local: { title: localTitle, body: found.body, updated: localUpdated },
        imported: { title, body: view.body, updated: importedUpdated },
        newer: localUpdated !== null && importedUpdated !== null && importedUpdated > localUpdated ? 'imported'
          : localUpdated !== null && importedUpdated !== null && localUpdated > importedUpdated ? 'local'
            : 'unknown',
      })
      const choice = choose(view.id)
      if (choice === 'take_imported') {
        const target = outcome.document.node(found.locator)
        if (target === undefined) throw new Error('the match comes from this document')
        target.setTitle(node.title)
        target.setBody(storedBody(view.body, eol))
        if (found.meta !== undefined && view.meta !== undefined && found.meta.id !== view.meta.id) {
          // A section keeps its local identity and takes the imported time.
          target.setMeta({ ...found.meta, updated: view.meta.updated })
        } else if (view.meta !== undefined) {
          target.setMeta(view.meta)
        }
        outcome.replaced += 1
      } else if (choice === 'keep_both') {
        const copy = node.detached(found.level, eol)
        if (copy.meta !== undefined) {
          const { section: _section, ...meta } = copy.meta
          copy.setMeta({ ...meta, id: unusedNodeId(mergedViews) })
        }
        const parent = found.locator.slice(0, -1)
        outcome.document.append(parent.length > 0 ? parent : undefined, copy)
        outcome.keptBoth += 1
      }
      continue
    }
    // The node is new here: place it under the node its imported parent maps to.
    const parentLocator = view.locator.slice(0, -1)
    let parent: readonly number[] | undefined
    let level = view.level
    if (parentLocator.length > 0) {
      const parentId = importedIds.get(parentLocator.join('/'))
      const target = parentId === undefined ? undefined : placed.get(parentId)
      if (target === undefined) throw MemoryError.invalid(`Packaged node \`${view.id}\` has no parent.`)
      const importedParent = imported.node(parentLocator)
      const mergedParent = outcome.document.node(target)
      if (importedParent === undefined || mergedParent === undefined) throw new Error('placed locators stay valid')
      parent = target
      level = mergedParent.level + (view.level - importedParent.level)
    }
    if (level > MAX_NODE_LEVEL) throw MemoryError.invalid(`Packaged node \`${view.id}\` would sit below heading level ${MAX_NODE_LEVEL}.`)
    const summary: NodeSummary = { id: view.id, path: view.path }
    if (mergedViews.some(existing => samePath(existing.path, view.path))) outcome.duplicates.push(summary)
    if (parent === undefined) outcome.newSections.push(viewTitle(view))
    outcome.added.push(summary)
    const siblings = parent === undefined ? outcome.document.roots.length : outcome.document.node(parent)?.children.length ?? 0
    outcome.document.append(parent, node.detached(level, eol))
    placed.set(view.id, [...parent ?? [], siblings])
  }
  return outcome
}

/** The local node an imported node stands for: a top-level section by its key, any other node by id. */
function matchingView(views: readonly NodeView[], imported: NodeView): NodeView | undefined {
  const section = (view: NodeView) => (view.locator.length === 1 ? view.meta?.section : undefined)
  const key = section(imported)
  if (key !== undefined) {
    const found = views.find(view => section(view) === key)
    if (found !== undefined) return found
  }
  return views.find(view => view.id === imported.id)
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((title, index) => title === right[index])
}

function unusedNodeId(views: readonly NodeView[]): string {
  for (;;) {
    const candidate = `m-${randomHex(8)}`
    if (!views.some(view => view.id === candidate)) return candidate
  }
}

/** The archive bytes: the manifest first, then the scope entries, deflated. */
export function writeArchive(manifest: string, entries: readonly (readonly [string, string])[]): Uint8Array {
  const encoder = new TextEncoder()
  const files: Record<string, Uint8Array> = { [MANIFEST_ENTRY]: encoder.encode(manifest) }
  for (const [name, text] of entries) files[name] = encoder.encode(text)
  return zipSync(files, { level: 6 })
}

/** Read and validate a package: format and version, a closed set of entries matching the manifest, bounded UTF-8 files. */
function readPackage(archive: Uint8Array, name: string): Package {
  if (archive.byteLength > MAX_PACKAGE_BYTES) throw MemoryError.invalid(`A memory package can be at most ${MAX_PACKAGE_BYTES} bytes.`)
  const digest = sha256(archive)
  const invalid = (detail: string) => new MemoryError('unsupported_format', `\`${name}\` is not a Vulcan memory package: ${detail}`)
  const seen = new Set<string>()
  let raw: Record<string, Uint8Array>
  try {
    raw = unzipSync(archive, {
      filter(entry) {
        if (seen.size >= MAX_PACKAGE_PROJECTS + 3) throw invalid('it has too many entries')
        if (entry.name.endsWith('/') || !enclosed(entry.name) || entry.originalSize > MAX_FILE_BYTES || seen.has(entry.name)) {
          throw invalid(`entry \`${entry.name}\` is not allowed`)
        }
        seen.add(entry.name)
        return true
      },
    })
  } catch (error) {
    throw error instanceof MemoryError ? error : invalid(error instanceof Error ? error.message : String(error))
  }
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const files = new Map<string, string>()
  for (const [entry, bytes] of Object.entries(raw)) {
    if (bytes.byteLength > MAX_FILE_BYTES) throw invalid(`entry \`${entry}\` is not allowed`)
    try {
      files.set(entry, decoder.decode(bytes))
    } catch {
      throw invalid(`entry \`${entry}\` is not UTF-8 text`)
    }
  }
  const manifestText = files.get(MANIFEST_ENTRY)
  if (manifestText === undefined) throw invalid('it has no manifest')
  files.delete(MANIFEST_ENTRY)
  let header: unknown
  try {
    header = JSON.parse(manifestText)
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : String(error))
  }
  if (!isRecord(header) || header['format'] !== PACKAGE_FORMAT || header['version'] !== EXPORT_FORMAT_VERSION) {
    throw new MemoryError('unsupported_format', `\`${name}\` must be a ${PACKAGE_FORMAT} package of format version ${EXPORT_FORMAT_VERSION}.`)
  }
  const manifest = parseManifest(header, invalid)
  const user = files.get(USER_ENTRY)
  const space = files.get(SPACE_ENTRY)
  files.delete(USER_ENTRY)
  files.delete(SPACE_ENTRY)
  if ((user !== undefined) !== manifest.user || (space !== undefined) !== manifest.space) throw invalid('its scope files do not match the manifest')
  const projects = new Map<string, string>()
  for (const project of manifest.projects) {
    const entry = `${PROJECT_ENTRY_PREFIX}${project.id}.md`
    const text = /^[A-Za-z0-9-]+$/.test(project.id) ? files.get(entry) : undefined
    if (text === undefined) throw invalid(`project \`${project.id}\` has no file`)
    files.delete(entry)
    if (projects.has(project.id)) throw invalid(`project \`${project.id}\` appears twice`)
    projects.set(project.id, text)
  }
  const extra = [...files.keys()].sort(compare)[0]
  if (extra !== undefined) throw invalid(`entry \`${extra}\` is not allowed`)
  return { sha256: digest, manifest, user, space, projects }
}

/** Whether an entry name stays inside the archive root, as `ZipFile::enclosed_name` requires. */
function enclosed(name: string): boolean {
  if (name.includes('\0') || name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/.test(name)) return false
  let depth = 0
  for (const part of name.split(/[/\\]/)) {
    if (part === '..') depth -= 1
    else if (part !== '' && part !== '.') depth += 1
    if (depth < 0) return false
  }
  return true
}

function parseManifest(value: Record<string, unknown>, invalid: (detail: string) => MemoryError): PackageManifest {
  const fields = ['format', 'version', 'exportedAt', 'user', 'space', 'projects']
  const unknown = Object.keys(value).find(key => !fields.includes(key))
  if (unknown !== undefined) throw invalid(`unknown field \`${unknown}\``)
  const { exportedAt, user, space, projects } = value
  if (typeof exportedAt !== 'string' || typeof user !== 'boolean' || typeof space !== 'boolean' || !Array.isArray(projects)) {
    throw invalid('the manifest fields have the wrong type')
  }
  return {
    format: PACKAGE_FORMAT,
    version: EXPORT_FORMAT_VERSION,
    exportedAt,
    user,
    space,
    projects: projects.map((project): PackageProject => {
      if (!isRecord(project) || Object.keys(project).some(key => !['id', 'name', 'paths', 'firstCommit'].includes(key))) {
        throw invalid('a manifest project has unknown fields')
      }
      const { id, name, paths, firstCommit } = project
      if (typeof id !== 'string' || typeof name !== 'string' || !Array.isArray(paths) || !paths.every(item => typeof item === 'string')
        || (firstCommit !== undefined && firstCommit !== null && typeof firstCommit !== 'string')) {
        throw invalid('a manifest project has fields of the wrong type')
      }
      return { id, name, paths, ...typeof firstCommit === 'string' ? { firstCommit } : {} }
    }),
  }
}

/** Parse the page's project mappings, refusing unknown fields like serde's `deny_unknown_fields`. */
export function parseMappings(value: unknown): ProjectMapping[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw MemoryError.invalid('`projects` must be an array.')
  return value.map((item): ProjectMapping => {
    if (!isRecord(item) || typeof item['packageProjectId'] !== 'string' || !isRecord(item['target'])
      || Object.keys(item).some(key => key !== 'packageProjectId' && key !== 'target')) {
      throw MemoryError.invalid('Each project mapping needs `packageProjectId` and `target`.')
    }
    const target = item['target']
    const keys = Object.keys(target)
    let parsed: ProjectTarget
    if (target['action'] === 'link' && typeof target['memoryProjectId'] === 'string' && keys.length === 2) {
      parsed = { action: 'link', memoryProjectId: target['memoryProjectId'] }
    } else if ((target['action'] === 'create' || target['action'] === 'ignore') && keys.length === 1) {
      parsed = { action: target['action'] }
    } else {
      throw MemoryError.invalid('A project target is `link` with `memoryProjectId`, `create` or `ignore`.')
    }
    return { packageProjectId: item['packageProjectId'], target: parsed }
  })
}

/** Parse the page's conflict resolutions. */
export function parseResolutions(value: unknown): ConflictResolution[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw MemoryError.invalid('`resolutions` must be an array.')
  return value.map((item): ConflictResolution => {
    if (!isRecord(item) || Object.keys(item).some(key => !['scope', 'packageProjectId', 'nodeId', 'choice'].includes(key))) {
      throw MemoryError.invalid('A resolution has unknown fields.')
    }
    const { scope, packageProjectId, nodeId, choice } = item
    if (!isScope(scope) || typeof nodeId !== 'string' || (choice !== 'keep_local' && choice !== 'take_imported' && choice !== 'keep_both')
      || (packageProjectId !== undefined && packageProjectId !== null && typeof packageProjectId !== 'string')) {
      throw MemoryError.invalid('A resolution needs `scope`, `nodeId` and a `choice` of keep_local, take_imported or keep_both.')
    }
    return { scope, ...typeof packageProjectId === 'string' ? { packageProjectId } : {}, nodeId, choice }
  })
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** `2026-10-20T15:59Z` → `20261020T1559Z`; the trailing `Z` keeps the stamp readable as UTC. */
function fileStamp(now: string): string {
  return now.replace(/[^A-Za-z0-9]/g, '')
}
