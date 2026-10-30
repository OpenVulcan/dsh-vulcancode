/**
 * File layout, project resolution and atomic commits of the memory store (`store.rs`).
 *
 * Every function here is synchronous, so within one process two writes can never interleave and
 * no lock object is needed; the commit still rechecks each file against the text it was read
 * from, which catches edits made by other processes or by hand.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { MAX_FILE_BYTES, byteLength } from './constants.js'
import { MemoryDocument } from './document.js'
import { MemoryError } from './errors.js'
import { MemoryRegistry, REGISTRY_FILE, randomHex, type MemoryProject } from './registry.js'
import type { MemoryScope } from './scope.js'

/** Attempts allowed for Windows sharing violations during replacement or rollback. */
const WINDOWS_MUTATION_ATTEMPTS = 5
/** Delay between Windows sharing-violation attempts; never applied to other errors or platforms. */
const WINDOWS_MUTATION_RETRY_MS = 25
/** Node's codes for Windows os errors 5 (access denied), 32 (sharing) and 33 (lock violation). */
const WINDOWS_TRANSIENT_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

export const MARKDOWN_DIRECTORY = 'markdown'

/** The project a request runs in, as known to the host. */
export interface ProjectContext {
  /** Host project id derived from the project root. */
  readonly hostProjectId?: string
  /** Project root path. */
  readonly rootPath?: string
  /** Explicit memory project chosen in the memory page, overriding the host binding. */
  readonly memoryProjectId?: string
}

/** The memory project a context addresses: the explicit choice or the host binding. */
export function boundProject(context: ProjectContext, registry: MemoryRegistry): MemoryProject | undefined {
  if (context.memoryProjectId !== undefined) {
    const project = registry.project(context.memoryProjectId)
    if (project === undefined) throw new MemoryError('project_unavailable', `Memory project \`${context.memoryProjectId}\` does not exist.`)
    return project
  }
  return context.hostProjectId === undefined ? undefined : registry.projectForHost(context.hostProjectId)
}

/** The documents of every scope visible to one request. */
export interface ScopeDocuments {
  readonly user: MemoryDocument
  readonly space: MemoryDocument
  /** Bound memory project and its document, when the host project is bound. */
  readonly project?: { readonly project: MemoryProject; readonly document: MemoryDocument }
}

export function scopeDocument(documents: ScopeDocuments, scope: MemoryScope): MemoryDocument | undefined {
  switch (scope) {
    case 'user': return documents.user
    case 'space': return documents.space
    case 'project': return documents.project?.document
  }
}

/** One file change prepared for an atomic commit. */
export interface PreparedFile {
  readonly path: string
  /** Exact text read before the change; `undefined` when the file did not exist. */
  readonly original: string | undefined
  readonly text: string
}

/** Handle to the memory files under `<dshHome>/vulcan-memory`; nothing is created on disk until a write. */
export class MarkdownMemoryStore {
  constructor(readonly memoryDirectory: string) {}

  get markdownDirectory(): string {
    return path.join(this.memoryDirectory, MARKDOWN_DIRECTORY)
  }

  /** The file path of a scope; the project scope needs a memory project id. */
  scopePath(scope: MemoryScope, memoryProjectId: string | undefined): string {
    const directory = this.markdownDirectory
    switch (scope) {
      case 'user': return path.join(directory, 'user.md')
      case 'space': return path.join(directory, 'space.md')
      case 'project': {
        if (memoryProjectId === undefined) {
          throw new MemoryError('project_unavailable', 'This conversation has no project, so project memory is unavailable.')
        }
        if (!/^[A-Za-z0-9-]+$/.test(memoryProjectId)) throw MemoryError.invalid(`\`${memoryProjectId}\` is not a memory project id.`)
        return path.join(directory, 'projects', `${memoryProjectId}.md`)
      }
    }
  }

  /** The registry; a missing file is empty. */
  registry(): MemoryRegistry {
    const file = path.join(this.markdownDirectory, REGISTRY_FILE)
    const text = readOptional(file)
    return text === undefined ? new MemoryRegistry() : MemoryRegistry.parse(text, file)
  }

  /** Change the registry and save it when the change succeeds. */
  updateRegistry<T>(change: (registry: MemoryRegistry) => T): T {
    const registry = this.registry()
    const value = change(registry)
    writeAtomically(path.join(this.markdownDirectory, REGISTRY_FILE), `${registry.toJson()}\n`)
    return value
  }

  /** One scope document; a missing file is an empty document. */
  load(scope: MemoryScope, memoryProjectId: string | undefined): MemoryDocument {
    const text = readOptional(this.scopePath(scope, memoryProjectId))
    return text === undefined ? MemoryDocument.empty() : MemoryDocument.parse(text)
  }

  /** Every scope visible to a project context. */
  loadScopes(context: ProjectContext): ScopeDocuments {
    const project = boundProject(context, this.registry())
    return {
      user: this.load('user', undefined),
      space: this.load('space', undefined),
      ...project === undefined ? {} : { project: { project, document: this.load('project', project.id) } },
    }
  }

  /** The exact text of one scope file for whole-file editing. */
  readFileText(scope: MemoryScope, memoryProjectId: string | undefined): string {
    return readOptional(this.scopePath(scope, memoryProjectId)) ?? ''
  }

  /** Replace one whole scope file when it still holds the text the editor started from. */
  replaceFileText(scope: MemoryScope, memoryProjectId: string | undefined, expected: string, text: string): void {
    if (byteLength(text) > MAX_FILE_BYTES) throw MemoryError.invalid(`A memory file can hold at most ${MAX_FILE_BYTES} bytes.`)
    const file = this.scopePath(scope, memoryProjectId)
    const original = readOptional(file)
    if ((original ?? '') !== expected) throw MemoryError.concurrent(file)
    commitFiles([{ path: file, original, text }])
  }
}

/** A file's exact text, or `undefined` when it does not exist. */
export function readOptional(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw MemoryError.io(file, 'read', error)
  }
}

/** Write text through a sibling temporary file and an atomic rename. */
export function writeAtomically(file: string, text: string): void {
  const temporary = writeTemporary(file, text)
  try {
    replaceFile(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw MemoryError.io(file, 'replaced', error)
  }
}

function writeTemporary(file: string, text: string): string {
  const parent = path.dirname(file)
  try {
    mkdirSync(parent, { recursive: true })
  } catch (error) {
    throw MemoryError.io(parent, 'created', error)
  }
  const temporary = path.join(parent, `.${path.basename(file)}.${randomHex(32)}.tmp`)
  try {
    writeFileSync(temporary, text, 'utf8')
  } catch (error) {
    rmSync(temporary, { force: true })
    throw MemoryError.io(temporary, 'written', error)
  }
  return temporary
}

/** Retry `operation` only for transient Windows replacement failures. */
export function retryFileMutation(operation: () => void): void {
  const windows = process.platform === 'win32'
  const attempts = windows ? WINDOWS_MUTATION_ATTEMPTS : 1
  for (let attempt = 0; ; attempt += 1) {
    try {
      operation()
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (!windows || code === undefined || !WINDOWS_TRANSIENT_CODES.has(code) || attempt + 1 >= attempts) throw error
      sleepSync(WINDOWS_MUTATION_RETRY_MS)
    }
  }
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

/** Atomically replace `destination` with `temporary`, retrying transient Windows sharing failures. */
export function replaceFile(temporary: string, destination: string): void {
  retryFileMutation(() => renameSync(temporary, destination))
}

/** Commit `files`; a failure restores completed replacements or reports preserved recovery copies. */
export function commitFiles(files: readonly PreparedFile[]): void {
  commitFilesWith(files, replaceFile)
}

/** The real commit and rollback algorithm, with a replacement operation tests can fault. */
export function commitFilesWith(files: readonly PreparedFile[], replace: (temporary: string, destination: string) => void): void {
  // Stage both directions before publishing anything, so rollback never needs to recreate original bytes.
  const staged: { replacement: string; original: string | undefined }[] = []
  // Recovery copies handed to the user survive the final cleanup.
  const detached = new Set<string>()
  try {
    for (const file of files) {
      if (readOptional(file.path) !== file.original) throw MemoryError.concurrent(file.path)
      const prepared: { replacement: string; original: string | undefined } = { replacement: writeTemporary(file.path, file.text), original: undefined }
      staged.push(prepared)
      if (file.original !== undefined) prepared.original = writeTemporary(file.path, file.original)
    }
    files.forEach((file, index) => {
      const stage = staged[index]!
      let failure: MemoryError | undefined
      try {
        // Recheck immediately before replacement to detect external edits during staging.
        if (readOptional(file.path) !== file.original) throw MemoryError.concurrent(file.path)
        try {
          replace(stage.replacement, file.path)
        } catch (error) {
          throw MemoryError.io(file.path, 'replaced', error)
        }
      } catch (error) {
        failure = error instanceof MemoryError ? error : MemoryError.io(file.path, 'replaced', error)
      }
      if (failure === undefined) return
      const inconsistent: string[] = []
      const recovery: string[] = []
      for (let completed = index - 1; completed >= 0; completed -= 1) {
        // Never overwrite an unrelated external edit while undoing this transaction.
        const previous = files[completed]!
        const previousStage = staged[completed]!
        let restored = false
        try {
          const current = readOptional(previous.path)
          if (current === previous.original) {
            restored = true
          } else if (current === previous.text) {
            if (previousStage.original !== undefined) replace(previousStage.original, previous.path)
            else retryFileMutation(() => rmSync(previous.path))
            restored = true
          }
        } catch {
          restored = false
        }
        if (!restored) {
          inconsistent.push(previous.path)
          if (previousStage.original !== undefined) {
            recovery.push(previousStage.original)
            detached.add(previousStage.original)
          }
        }
      }
      if (inconsistent.length === 0) throw failure
      throw new MemoryError('rollback_incomplete', `Memory commit failed: ${failure.message}. Rollback is incomplete for ${JSON.stringify(inconsistent)}. Original recovery files: ${JSON.stringify(recovery)}. Restore these files before retrying.`)
    })
  } finally {
    for (const stage of staged) {
      rmSync(stage.replacement, { force: true })
      if (stage.original !== undefined && !detached.has(stage.original)) rmSync(stage.original, { force: true })
    }
  }
}
