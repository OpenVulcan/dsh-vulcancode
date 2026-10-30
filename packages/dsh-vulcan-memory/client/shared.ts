/** Facts the browser half shares with the Host half (`src/page.ts`). */

/** Checked against `package.json` by `scripts/bundle-client.mjs`. */
export const PACKAGE_NAME = '@openvulcan/dsh-vulcan-memory'
/** The main panel the sidebar entry opens. */
export const PANEL_ID = 'vulcan-memory'
/** Mirrors `ROUTE_PREFIX` in `src/index.ts`, below the page's origin. */
const ROUTE_BASE = '/api/vulcan-memory/'

export type MemoryScope = 'user' | 'space' | 'project'
export type MemoryMode = 'off' | 'markdown' | 'vmm'
export type BudgetPart = 'user' | 'spaceBase' | 'projectBase' | 'spaceCatalog' | 'projectCatalog'
export type InjectionBudget = Readonly<Record<BudgetPart, number>>

export const SCOPES: readonly MemoryScope[] = ['user', 'space', 'project']
/** Full-text parts first, then catalogs, as VulcanCode orders the budget fields. */
export const BUDGET_PARTS: readonly BudgetPart[] = ['user', 'spaceBase', 'projectBase', 'spaceCatalog', 'projectCatalog']

/** Mirrors `MemorySettingsView`. */
export interface MemorySettingsView {
  readonly mode: MemoryMode
  readonly budget: InjectionBudget
  readonly defaultBudget: InjectionBudget
  readonly maxPartTokens: number
  readonly warningPercent: number
}

/** Mirrors `NodeViewModel`. */
export interface MemoryNode {
  readonly id: string
  readonly level: number
  readonly path: readonly string[]
  readonly section: string | null
  readonly revision: string
  readonly body: string
  readonly created: string | null
  readonly updated: string | null
  readonly session: string | null
  readonly source: string | null
  readonly descendants: number
}

/** Mirrors `ProjectView`. */
export interface MemoryProject {
  readonly id: string
  readonly name: string
  readonly hostProjectIds: readonly string[]
  readonly paths: readonly string[]
  readonly memoryEnabled: boolean
  readonly orphaned: boolean
  readonly updated: string
}

/** Mirrors `HostProject`: one dsh workspace. */
export interface HostProject {
  readonly id: string
  readonly path: string
  readonly title: string
}

/** Mirrors `MemoryOverview`. */
export interface MemoryOverview {
  readonly settings: MemorySettingsView
  readonly user: readonly MemoryNode[]
  readonly space: readonly MemoryNode[]
  readonly project: readonly MemoryNode[]
  readonly memoryProjectId: string | null
  readonly boundMemoryProjectId: string | null
  readonly hostProjectId: string | null
  readonly orphanCandidates: readonly { readonly memoryProjectId: string; readonly reasons: readonly string[] }[]
  readonly projects: readonly MemoryProject[]
  readonly usage: readonly { readonly part: BudgetPart; readonly tokens: number; readonly budget: number; readonly omitted: readonly string[] }[]
  readonly presetSections: readonly { readonly scope: MemoryScope; readonly key: string; readonly title: string }[]
  readonly hostProjects: readonly HostProject[]
}

/** The project a page request addresses: a host project, or a memory project without one. */
export interface MemoryTarget {
  readonly projectId?: string
  readonly memoryProjectId?: string
}

/** Same JSON shape as the `memory_write` tool's operations. */
export type MemoryOperation =
  | { action: 'create'; scope: MemoryScope; title: string; body: string; parentId?: string; section?: string }
  | { action: 'replace'; id: string; expectedRevision: string; body: string }
  | { action: 'rename'; id: string; expectedRevision: string; title: string }
  | { action: 'move'; id: string; expectedRevision: string; scope: MemoryScope; parentId?: string; section?: string }
  | { action: 'delete'; id: string; expectedRevision: string; withChildren: boolean }

/** Mirrors `ProjectAction`. */
export type ProjectAction =
  | { action: 'link'; projectId: string; memoryProjectId: string }
  | { action: 'create'; projectId: string }
  | { action: 'ignore'; projectId: string }
  | { action: 'set_enabled'; memoryProjectId: string; enabled: boolean }
  | { action: 'rename'; memoryProjectId: string; name: string }

export interface MemoryFile {
  readonly path: string
  readonly text: string
}

// Import and export, mirroring `src/markdown/package.ts`.

export type ConflictChoice = 'keep_local' | 'take_imported' | 'keep_both'

export interface ProjectMapping {
  readonly packageProjectId: string
  readonly target: { action: 'link'; memoryProjectId: string } | { action: 'create' } | { action: 'ignore' }
}

export interface PackageProject {
  readonly id: string
  readonly name: string
  readonly paths: readonly string[]
  readonly firstCommit?: string
}

export interface NodeSide {
  readonly title: string
  readonly body: string
  readonly updated: string | null
}

export interface NodeConflict {
  readonly id: string
  readonly path: readonly string[]
  readonly local: NodeSide
  readonly imported: NodeSide
  readonly newer: 'local' | 'imported' | 'unknown'
}

export interface ScopeMergePreview {
  readonly scope: MemoryScope
  readonly packageProjectId: string | null
  readonly memoryProjectId: string | null
  readonly same: number
  readonly added: readonly { readonly id: string; readonly path: readonly string[] }[]
  readonly duplicates: readonly { readonly id: string; readonly path: readonly string[] }[]
  readonly conflicts: readonly NodeConflict[]
  readonly newSections: readonly string[]
}

export interface ImportPreview {
  readonly sha256: string
  readonly exportedAt: string
  readonly projects: readonly {
    readonly project: PackageProject
    readonly candidates: readonly { readonly memoryProjectId: string; readonly name: string; readonly reasons: readonly string[] }[]
  }[]
  readonly scopes: readonly ScopeMergePreview[]
}

export interface ImportReport {
  readonly backupDirectory: string | null
  readonly added: number
  readonly replaced: number
  readonly unchanged: number
  readonly createdProjects: readonly string[]
}

export interface ExportedPackage {
  readonly fileName: string
  /** Base64 archive bytes. */
  readonly archive: string
  readonly sha256: string
}

export async function callHost<T>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${ROUTE_BASE}${route}`, {
    method,
    ...body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } },
  })
  const answer = await response.json().catch(() => undefined) as { ok?: boolean; value?: T; error?: { message?: string } } | undefined
  if (answer?.ok !== true) throw new Error(answer?.error?.message ?? `HTTP ${response.status}`)
  return answer.value as T
}

export function loadOverview(target: MemoryTarget): Promise<MemoryOverview> {
  const params = new URLSearchParams()
  if (target.projectId !== undefined) params.set('projectId', target.projectId)
  if (target.memoryProjectId !== undefined) params.set('memoryProjectId', target.memoryProjectId)
  return callHost<MemoryOverview>('GET', `overview?${params.toString()}`)
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function nodeTitle(node: { readonly path: readonly string[] }): string {
  return node.path[node.path.length - 1] ?? ''
}

/** Base64 of bytes, in chunks small enough for `String.fromCharCode`. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Save bytes as a file through the browser. */
export function download(fileName: string, bytes: Uint8Array<ArrayBuffer>): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => { URL.revokeObjectURL(url) }, 0)
}
