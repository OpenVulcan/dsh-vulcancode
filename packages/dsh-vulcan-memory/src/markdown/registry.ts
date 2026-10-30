/** Memory projects and their bindings to host projects (`registry.rs`); stored as `markdown/registry.json`. */

import { randomBytes } from 'node:crypto'

import { MAX_TITLE_CHARS, REGISTRY_FORMAT_VERSION } from './constants.js'
import { MemoryError } from './errors.js'

export interface MemoryProject {
  /** Random id that names the project's memory file. */
  id: string
  /** Display name, initially the directory name. */
  name: string
  /** Host project ids currently bound to this memory project. */
  hostProjectIds: string[]
  /** Every root path the project was opened from, oldest first. */
  paths: string[]
  firstCommit?: string
  memoryEnabled: boolean
  created: string
  updated: string
}

/** An orphaned memory project offered for linking, with the reasons it ranks where it does. */
export interface OrphanCandidate {
  readonly project: MemoryProject
  readonly reasons: readonly ('same_directory_name' | 'same_first_commit')[]
}

export const REGISTRY_FILE = 'registry.json'

export class MemoryRegistry {
  constructor(
    readonly projects: MemoryProject[] = [],
    /** Host projects whose orphan prompt the user dismissed. */
    public ignoredHostProjectIds: string[] = [],
  ) {}

  /** Parse registry file text; a format other than version 1 is refused. */
  static parse(text: string, path: string): MemoryRegistry {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (error) {
      throw MemoryError.json(path, error instanceof Error ? error.message : String(error))
    }
    if (!isRecord(value) || value['version'] !== REGISTRY_FORMAT_VERSION) {
      throw new MemoryError('unsupported_format', `Memory registry \`${path}\` must declare format version ${REGISTRY_FORMAT_VERSION}.`)
    }
    const projects = value['projects']
    const ignored = value['ignoredHostProjectIds']
    if (!Array.isArray(projects) || !Array.isArray(ignored) || !ignored.every(item => typeof item === 'string')) {
      throw MemoryError.json(path, 'expected `projects` and `ignoredHostProjectIds` arrays')
    }
    return new MemoryRegistry(projects.map(project => parseProject(project, path)), ignored)
  }

  /** The versioned file text, without the final newline. */
  toJson(): string {
    return JSON.stringify({
      version: REGISTRY_FORMAT_VERSION,
      projects: this.projects.map(project => ({
        id: project.id,
        name: project.name,
        hostProjectIds: project.hostProjectIds,
        paths: project.paths,
        ...project.firstCommit === undefined ? {} : { firstCommit: project.firstCommit },
        memoryEnabled: project.memoryEnabled,
        created: project.created,
        updated: project.updated,
      })),
      ignoredHostProjectIds: this.ignoredHostProjectIds,
    }, null, 2)
  }

  projectForHost(hostProjectId: string): MemoryProject | undefined {
    return this.projects.find(project => project.hostProjectIds.includes(hostProjectId))
  }

  project(id: string): MemoryProject | undefined {
    return this.projects.find(project => project.id === id)
  }

  private projectOrThrow(id: string): MemoryProject {
    const project = this.project(id)
    if (project === undefined) throw MemoryError.invalid(`Memory project \`${id}\` does not exist.`)
    return project
  }

  /** Create a memory project bound to a host project and return its id. */
  createForHost(hostProjectId: string, rootPath: string, firstCommit: string | undefined, now: string): string {
    this.unbindHost(hostProjectId)
    const id = this.unusedProjectId()
    this.projects.push({
      id,
      name: directoryName(rootPath),
      hostProjectIds: [hostProjectId],
      paths: [rootPath],
      ...firstCommit === undefined ? {} : { firstCommit },
      memoryEnabled: true,
      created: now,
      updated: now,
    })
    this.ignoredHostProjectIds = this.ignoredHostProjectIds.filter(ignored => ignored !== hostProjectId)
    return id
  }

  /** Create a memory project bound to no host project, such as one restored from an export package. */
  createUnbound(name: string, paths: string[], firstCommit: string | undefined, now: string): string {
    const id = this.unusedProjectId()
    this.projects.push({
      id,
      name,
      hostProjectIds: [],
      paths,
      ...firstCommit === undefined ? {} : { firstCommit },
      memoryEnabled: true,
      created: now,
      updated: now,
    })
    return id
  }

  /** Bind a host project to an existing memory project and record the path. */
  link(memoryProjectId: string, hostProjectId: string, rootPath: string, now: string): void {
    this.projectOrThrow(memoryProjectId)
    this.unbindHost(hostProjectId)
    const project = this.projectOrThrow(memoryProjectId)
    project.hostProjectIds.push(hostProjectId)
    if (!project.paths.includes(rootPath)) project.paths.push(rootPath)
    project.updated = now
    this.ignoredHostProjectIds = this.ignoredHostProjectIds.filter(ignored => ignored !== hostProjectId)
  }

  ignoreHost(hostProjectId: string): void {
    if (!this.ignoredHostProjectIds.includes(hostProjectId)) this.ignoredHostProjectIds.push(hostProjectId)
  }

  setEnabled(memoryProjectId: string, enabled: boolean, now: string): void {
    const project = this.projectOrThrow(memoryProjectId)
    project.memoryEnabled = enabled
    project.updated = now
  }

  rename(memoryProjectId: string, name: string, now: string): void {
    const trimmed = name.trim()
    if (trimmed === '' || [...trimmed].length > MAX_TITLE_CHARS) {
      throw MemoryError.invalid(`A memory project name must have 1 to ${MAX_TITLE_CHARS} characters.`)
    }
    const project = this.projectOrThrow(memoryProjectId)
    project.name = trimmed
    project.updated = now
  }

  /** Orphaned projects ranked for a host project, or nothing once it is bound or dismissed. */
  orphanCandidates(hostProjectId: string, rootPath: string, firstCommit: string | undefined, pathExists: (path: string) => boolean): OrphanCandidate[] {
    if (this.projectForHost(hostProjectId) !== undefined || this.ignoredHostProjectIds.includes(hostProjectId)) return []
    const name = directoryName(rootPath).toLowerCase()
    const score = (candidate: OrphanCandidate) => candidate.reasons.reduce((sum, reason) => sum + (reason === 'same_first_commit' ? 2 : 1), 0)
    return this.projects
      .filter(project => project.paths.length > 0 && !project.paths.some(pathExists))
      .map((project): OrphanCandidate => {
        const reasons: ('same_directory_name' | 'same_first_commit')[] = []
        if (project.paths.some(path => directoryName(path).toLowerCase() === name)) reasons.push('same_directory_name')
        if (firstCommit !== undefined && project.firstCommit === firstCommit) reasons.push('same_first_commit')
        return { project, reasons }
      })
      .sort((left, right) => score(right) - score(left) || compare(right.project.updated, left.project.updated))
  }

  private unbindHost(hostProjectId: string): void {
    for (const project of this.projects) project.hostProjectIds = project.hostProjectIds.filter(bound => bound !== hostProjectId)
  }

  private unusedProjectId(): string {
    for (;;) {
      const candidate = `p-${randomHex(10)}`
      if (this.project(candidate) === undefined) return candidate
    }
  }
}

/** The last path component, accepting both separators. */
export function directoryName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  return trimmed.split(/[/\\]/).pop() ?? path
}

/** Lowercase hex of the given length, like the prefix of a simple UUID. */
export function randomHex(length: number): string {
  return randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length)
}

/** Ordinal string comparison, the order Rust's `str::cmp` gives. */
export function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function parseProject(value: unknown, path: string): MemoryProject {
  const fields = ['id', 'name', 'hostProjectIds', 'paths', 'firstCommit', 'memoryEnabled', 'created', 'updated']
  if (!isRecord(value) || Object.keys(value).some(key => !fields.includes(key))) throw MemoryError.json(path, 'a project has unknown fields')
  const { id, name, hostProjectIds, paths, firstCommit, memoryEnabled, created, updated } = value
  const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every(item => typeof item === 'string')
  if (typeof id !== 'string' || typeof name !== 'string' || !strings(hostProjectIds) || !strings(paths)
    || (firstCommit !== undefined && typeof firstCommit !== 'string') || typeof memoryEnabled !== 'boolean'
    || typeof created !== 'string' || typeof updated !== 'string') {
    throw MemoryError.json(path, `project ${JSON.stringify(id)} has fields of the wrong type`)
  }
  return { id, name, hostProjectIds, paths, ...firstCommit === undefined ? {} : { firstCommit }, memoryEnabled, created, updated }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
