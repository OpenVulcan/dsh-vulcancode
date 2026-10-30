/**
 * What the memory page asks of the Host (`markdown_memory_services.rs`): the overview of one host
 * project, writes as the user, whole-file editing, registry changes, settings, and export/import.
 * Host projects are dsh workspaces; export packages travel through the browser as base64, since the
 * page may run on another machine than the Host.
 */

import { existsSync } from 'node:fs'

import type { Workspace } from '@deepseek-ai/dsh-workspace'

import { MAX_PART_TOKENS, BUDGET_WARNING_PERCENT } from './markdown/constants.js'
import type { NodeView } from './markdown/document.js'
import { MemoryError } from './markdown/errors.js'
import { parseWriteOperation, writeMemory } from './markdown/operations.js'
import {
  applyImport, exportPackage, parseMappings, parseResolutions, previewImport, type ImportPreview, type ImportReport,
} from './markdown/package.js'
import { isRecord, type MemoryProject } from './markdown/registry.js'
import { SCOPES, isScope, presetSections, type MemoryScope } from './markdown/scope.js'
import { buildInjectionSnapshot } from './markdown/snapshot.js'
import type { MarkdownMemoryStore, ProjectContext, ScopeDocuments } from './markdown/store.js'
import { nowUtcMinute } from './markdown/timestamp.js'
import { hostProjectId, normalizeRoot } from './project.js'
import { DEFAULT_BUDGET, loadSettings, saveSettings, validateSettings, type InjectionBudget, type MemorySettings } from './settings.js'

/** A dsh workspace as the memory page sees it. */
export interface HostProject {
  /** Host project id derived from the root, the same id sessions in it use. */
  readonly id: string
  readonly path: string
  readonly title: string
}

export interface MemorySettingsView extends MemorySettings {
  readonly defaultBudget: InjectionBudget
  readonly maxPartTokens: number
  readonly warningPercent: number
}

export interface NodeViewModel {
  readonly id: string
  readonly level: number
  readonly path: readonly string[]
  readonly section: string | null
  readonly revision: string
  readonly body: string
  readonly created: string | null
  readonly updated: string | null
  readonly session: string | null
  /** `ai` or `user`; `null` for nodes never written through memory. */
  readonly source: string | null
  readonly descendants: number
}

export interface ProjectView {
  readonly id: string
  readonly name: string
  readonly hostProjectIds: readonly string[]
  readonly paths: readonly string[]
  readonly memoryEnabled: boolean
  /** No recorded path exists any more. */
  readonly orphaned: boolean
  readonly updated: string
}

export interface MemoryOverview {
  readonly settings: MemorySettingsView
  readonly user: readonly NodeViewModel[]
  readonly space: readonly NodeViewModel[]
  readonly project: readonly NodeViewModel[]
  /** Memory project shown in the project tab. */
  readonly memoryProjectId: string | null
  /** Memory project bound to the host project. */
  readonly boundMemoryProjectId: string | null
  readonly hostProjectId: string | null
  /** Orphans suggested for linking; empty once bound or dismissed. */
  readonly orphanCandidates: readonly { readonly memoryProjectId: string; readonly reasons: readonly string[] }[]
  readonly projects: readonly ProjectView[]
  readonly usage: readonly { readonly part: string; readonly tokens: number; readonly budget: number; readonly omitted: readonly string[] }[]
  readonly presetSections: readonly { readonly scope: MemoryScope; readonly key: string; readonly title: string }[]
  /** Every dsh workspace, for the project selector; VulcanCode's page reads them from its own store. */
  readonly hostProjects: readonly HostProject[]
}

/** One registry change requested by the page. */
export type ProjectAction =
  | { readonly action: 'link'; readonly projectId: string; readonly memoryProjectId: string }
  | { readonly action: 'create'; readonly projectId: string }
  | { readonly action: 'ignore'; readonly projectId: string }
  | { readonly action: 'set_enabled'; readonly memoryProjectId: string; readonly enabled: boolean }
  | { readonly action: 'rename'; readonly memoryProjectId: string; readonly name: string }

export function hostProjectOf(workspace: Pick<Workspace, 'path' | 'title'>): HostProject {
  const root = normalizeRoot(workspace.path)
  return { id: hostProjectId(root), path: root, title: workspace.title }
}

/** The host project of a page request; an unknown id is refused, as VulcanCode refuses it. */
export function resolveHost(hosts: readonly HostProject[], projectId: string | undefined): HostProject | undefined {
  const id = projectId?.trim()
  if (id === undefined || id === '') return undefined
  const host = hosts.find(item => item.id === id)
  if (host === undefined) throw MemoryError.invalid(`Unknown project: ${id}`)
  return host
}

export function settingsView(settings: MemorySettings): MemorySettingsView {
  return { ...settings, defaultBudget: DEFAULT_BUDGET, maxPartTokens: MAX_PART_TOKENS, warningPercent: BUDGET_WARNING_PERCENT }
}

export function loadOverview(store: MarkdownMemoryStore, hosts: readonly HostProject[], host: HostProject | undefined, memoryProjectId: string | undefined): MemoryOverview {
  const settings = loadSettings(store.memoryDirectory)
  const registry = store.registry()
  const bound = host === undefined ? undefined : registry.projectForHost(host.id)?.id
  const shownId = memoryProjectId ?? bound
  let documents: ScopeDocuments = { user: store.load('user', undefined), space: store.load('space', undefined) }
  if (shownId !== undefined) {
    const project = registry.project(shownId)
    if (project === undefined) throw new MemoryError('project_unavailable', `Memory project \`${shownId}\` does not exist.`)
    documents = { ...documents, project: { project, document: store.load('project', project.id) } }
  }
  const orphans = host === undefined ? [] : registry.orphanCandidates(host.id, host.path, undefined, existsSync)
  return {
    settings: settingsView(settings),
    user: nodeViews(documents.user.views('user')),
    space: nodeViews(documents.space.views('space')),
    project: documents.project === undefined ? [] : nodeViews(documents.project.document.views('project')),
    memoryProjectId: shownId ?? null,
    boundMemoryProjectId: bound ?? null,
    hostProjectId: host?.id ?? null,
    orphanCandidates: orphans.map(candidate => ({ memoryProjectId: candidate.project.id, reasons: candidate.reasons })),
    projects: registry.projects.map(projectView),
    usage: buildInjectionSnapshot(documents, settings.budget).usage.map(usage => ({ ...usage })),
    presetSections: SCOPES.flatMap(scope => presetSections(scope).map(([key, title]) => ({ scope, key, title }))),
    hostProjects: hosts,
  }
}

/** Write as the user; the first project write may create and bind a memory project. Disabled projects stay editable. */
export function writeAsUser(store: MarkdownMemoryStore, hosts: readonly HostProject[], host: HostProject | undefined, memoryProjectId: string | undefined, operations: unknown): MemoryOverview {
  if (!Array.isArray(operations)) throw MemoryError.invalid('`operations` must be an array.')
  const parsed = operations.map((operation, index) => {
    try {
      return parseWriteOperation(operation)
    } catch (error) {
      throw error instanceof MemoryError ? MemoryError.invalid(`Operation ${index} is invalid: ${error.message}`) : error
    }
  })
  const context: ProjectContext = {
    ...host === undefined ? {} : { hostProjectId: host.id, rootPath: host.path },
    ...memoryProjectId === undefined ? {} : { memoryProjectId },
  }
  const receipt = writeMemory(store, context, { session: undefined, source: 'user' }, loadSettings(store.memoryDirectory).budget, parsed)
  return loadOverview(store, hosts, host, memoryProjectId ?? receipt.createdProject)
}

export function applyProjectAction(store: MarkdownMemoryStore, host: HostProject | undefined, action: ProjectAction): ProjectView[] {
  const now = nowUtcMinute()
  const hostPath = (): string => {
    if (host === undefined) throw new MemoryError('project_unavailable', 'The host project is unknown.')
    return host.path
  }
  return store.updateRegistry((registry) => {
    switch (action.action) {
      case 'link': registry.link(action.memoryProjectId, action.projectId, hostPath(), now); break
      case 'create': registry.createForHost(action.projectId, hostPath(), undefined, now); break
      case 'ignore': registry.ignoreHost(action.projectId); break
      case 'set_enabled': registry.setEnabled(action.memoryProjectId, action.enabled, now); break
      case 'rename': registry.rename(action.memoryProjectId, action.name, now); break
    }
    return registry.projects.map(projectView)
  })
}

/** The host project a registry action names; only link, create and ignore name one. */
export function actionHostId(action: ProjectAction): string | undefined {
  return action.action === 'link' || action.action === 'create' || action.action === 'ignore' ? action.projectId : undefined
}

export function readFile(store: MarkdownMemoryStore, scope: MemoryScope, memoryProjectId: string | undefined): { path: string; text: string } {
  return { path: store.scopePath(scope, memoryProjectId), text: store.readFileText(scope, memoryProjectId) }
}

export function replaceFile(store: MarkdownMemoryStore, scope: MemoryScope, memoryProjectId: string | undefined, expected: string, text: string): { path: string; text: string } {
  store.replaceFileText(scope, memoryProjectId, expected, text)
  return { path: store.scopePath(scope, memoryProjectId), text }
}

function projectView(project: MemoryProject): ProjectView {
  return {
    id: project.id,
    name: project.name,
    hostProjectIds: [...project.hostProjectIds],
    paths: [...project.paths],
    memoryEnabled: project.memoryEnabled,
    orphaned: project.paths.length > 0 && !project.paths.some(existsSync),
    updated: project.updated,
  }
}

function nodeViews(views: readonly NodeView[]): NodeViewModel[] {
  return views.map(view => ({
    id: view.id,
    level: view.level,
    path: view.path,
    section: view.section ?? null,
    revision: view.revision,
    body: view.body,
    created: view.meta?.created ?? null,
    updated: view.meta?.updated ?? null,
    session: view.meta?.session ?? null,
    source: view.meta?.source ?? null,
    descendants: view.descendants,
  }))
}

// ---- Request parsing: unknown fields are refused, as serde's `deny_unknown_fields` does. ----

/** An object holding only the listed fields. */
export function fields(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw MemoryError.invalid('The request body must be a JSON object.')
  const unknown = Object.keys(value).find(key => !allowed.includes(key))
  if (unknown !== undefined) throw MemoryError.invalid(`Unknown field \`${unknown}\`.`)
  return value
}

export function text(input: Record<string, unknown>, field: string): string {
  const value = input[field]
  if (typeof value !== 'string') throw MemoryError.invalid(`\`${field}\` must be a string.`)
  return value
}

export function optionalText(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw MemoryError.invalid(`\`${field}\` must be a string.`)
  return value
}

function flag(input: Record<string, unknown>, field: string): boolean {
  const value = input[field]
  if (typeof value !== 'boolean') throw MemoryError.invalid(`\`${field}\` must be true or false.`)
  return value
}

export function scopeParam(value: unknown): MemoryScope {
  if (!isScope(value)) throw MemoryError.invalid(`\`${String(value)}\` is not a memory scope.`)
  return value
}

export function parseProjectAction(value: unknown): ProjectAction {
  if (!isRecord(value)) throw MemoryError.invalid('The request body must be a JSON object.')
  switch (value['action']) {
    case 'link': {
      const input = fields(value, ['action', 'projectId', 'memoryProjectId'])
      return { action: 'link', projectId: text(input, 'projectId'), memoryProjectId: text(input, 'memoryProjectId') }
    }
    case 'create':
    case 'ignore': {
      const input = fields(value, ['action', 'projectId'])
      return { action: value['action'], projectId: text(input, 'projectId') }
    }
    case 'set_enabled': {
      const input = fields(value, ['action', 'memoryProjectId', 'enabled'])
      return { action: 'set_enabled', memoryProjectId: text(input, 'memoryProjectId'), enabled: flag(input, 'enabled') }
    }
    case 'rename': {
      const input = fields(value, ['action', 'memoryProjectId', 'name'])
      return { action: 'rename', memoryProjectId: text(input, 'memoryProjectId'), name: text(input, 'name') }
    }
    default: throw MemoryError.invalid('`action` must be link, create, ignore, set_enabled or rename.')
  }
}

export function parseSettingsSave(value: unknown): MemorySettings {
  const input = fields(value, ['mode', 'budget'])
  const settings = { mode: input['mode'], budget: input['budget'] }
  validateSettings(settings)
  return settings
}

/** Archive bytes sent by the page as base64. */
export function archiveBytes(input: Record<string, unknown>): Uint8Array {
  const encoded = text(input, 'archive')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw MemoryError.invalid('`archive` must be base64.')
  return new Uint8Array(Buffer.from(encoded, 'base64'))
}

export function exportRequest(store: MarkdownMemoryStore, value: unknown): { fileName: string; archive: string; sha256: string } {
  const input = fields(value, ['user', 'space', 'memoryProjectIds'])
  const ids = input['memoryProjectIds'] ?? []
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) throw MemoryError.invalid('`memoryProjectIds` must be an array of strings.')
  const exported = exportPackage(store, { user: flag(input, 'user'), space: flag(input, 'space'), memoryProjectIds: ids })
  return { fileName: exported.fileName, archive: Buffer.from(exported.bytes).toString('base64'), sha256: exported.sha256 }
}

export function previewRequest(store: MarkdownMemoryStore, value: unknown): ImportPreview {
  const input = fields(value, ['archive', 'name', 'projects'])
  return previewImport(store, archiveBytes(input), text(input, 'name'), parseMappings(input['projects']))
}

export function importRequest(store: MarkdownMemoryStore, value: unknown): ImportReport {
  const input = fields(value, ['archive', 'name', 'expectedSha256', 'projects', 'resolutions'])
  return applyImport(store, archiveBytes(input), text(input, 'name'), text(input, 'expectedSha256'), parseMappings(input['projects']), parseResolutions(input['resolutions']))
}

export { saveSettings }
