/**
 * The project a dsh session belongs to, for memory. A session is in the project of the directory
 * it was created in (`SessionHeader.cwd`); the host project id is derived from that path, so
 * every session opened in the same directory shares one project memory, and a moved checkout is
 * offered for linking by the registry's orphan candidates.
 */

import { createHash } from 'node:crypto'
import path from 'node:path'

import type { ProjectContext } from './markdown/store.js'

export const HOST_PROJECT_PREFIX = 'dshproject-'

/** The absolute directory without a trailing separator. */
export function normalizeRoot(directory: string): string {
  const resolved = path.resolve(directory)
  const root = path.parse(resolved).root
  return resolved.length > root.length ? resolved.replace(/[/\\]+$/, '') : resolved
}

/** Stable host project id of a root; Windows paths are case-insensitive, so they hash lowercased. */
export function hostProjectId(root: string, platform: NodeJS.Platform = process.platform): string {
  const key = platform === 'win32' ? root.toLowerCase() : root
  return `${HOST_PROJECT_PREFIX}${createHash('sha256').update(key).digest('hex').slice(0, 16)}`
}

/** The memory project context of a session created in `cwd`; none when the session has no directory. */
export function projectContext(cwd: string | undefined): ProjectContext {
  if (cwd === undefined || cwd.trim() === '') return {}
  const rootPath = normalizeRoot(cwd)
  return { hostProjectId: hostProjectId(rootPath), rootPath }
}
