/**
 * Markdown memory as the plugin uses it: resolve whether memory is active for a session's project,
 * run the three tools, and build the injection snapshot. Everything Markdown-specific stays below
 * this module; the plugin entry only calls these functions.
 */

import { MAX_NODE_LEVEL, MAX_OPERATIONS_PER_WRITE, MAX_SEARCH_LIMIT, MAX_SEARCH_PATTERNS } from './constants.js'
import { MemoryError } from './errors.js'
import { parseWriteOperation, renderWriteReceipt, writeMemory, type WriteAuthor } from './operations.js'
import { SCOPES, isScope, presetSections, type MemoryScope } from './scope.js'
import { renderOutline, renderSearchPage, searchNodes, type OutlineRequest, type SearchRequest } from './search.js'
import { buildInjectionSnapshot } from './snapshot.js'
import { MarkdownMemoryStore, type ProjectContext } from './store.js'
import { isRecord } from './registry.js'
import type { InjectionBudget, MemorySettings } from '../settings.js'

export { MarkdownMemoryStore } from './store.js'
export type { ProjectContext } from './store.js'

/** Memory reachable from one session: the store, its project and the budget. */
export interface MarkdownMemoryAccess {
  readonly store: MarkdownMemoryStore
  readonly context: ProjectContext
  readonly budget: InjectionBudget
}

/**
 * Memory of a project, or `undefined` when the mode is not `markdown` or the user turned memory
 * off for this project (which also hides the user and space scopes), as VulcanCode resolves it.
 */
export function resolveAccess(store: MarkdownMemoryStore, settings: MemorySettings, context: ProjectContext): MarkdownMemoryAccess | undefined {
  if (settings.mode !== 'markdown') return undefined
  if (context.hostProjectId !== undefined && store.registry().projectForHost(context.hostProjectId)?.memoryEnabled === false) return undefined
  return { store, context, budget: settings.budget }
}

export const NOT_ACTIVE_MESSAGE = 'Markdown memory is not active for this conversation; the memory mode changed or memory is off for this project.'

export function outline(access: MarkdownMemoryAccess, args: unknown): string {
  return renderOutline(access.store.loadScopes(access.context), parseOutlineRequest(args))
}

export function search(access: MarkdownMemoryAccess, args: unknown): string {
  return renderSearchPage(searchNodes(access.store.loadScopes(access.context), parseSearchRequest(args)))
}

export function write(access: MarkdownMemoryAccess, author: WriteAuthor, args: unknown): string {
  const input = expectObject(args, ['operations'])
  const operations = input['operations']
  if (!Array.isArray(operations)) throw invalidArguments('missing field `operations`')
  let parsed
  try {
    parsed = operations.map(parseWriteOperation)
  } catch (error) {
    throw error instanceof MemoryError ? invalidArguments(error.message) : error
  }
  return renderWriteReceipt(writeMemory(access.store, access.context, author, access.budget, parsed))
}

/** The snapshot text injected into a conversation; empty when every scope is empty. */
export function snapshot(access: MarkdownMemoryAccess): string {
  return buildInjectionSnapshot(access.store.loadScopes(access.context), access.budget).content
}

const SCOPE_SCHEMA = { type: 'string', enum: [...SCOPES] }

function presetSectionKeys(): string {
  return SCOPES.map(scope => `${scope} (${presetSections(scope).map(([key]) => key).join(', ')})`).join('; ')
}

/** Model-facing names, descriptions and schemas, the same text VulcanCode registers. */
export const TOOL_SPECS = {
  outline: {
    name: 'memory_outline',
    description: 'List the heading tree of long-term memory: the user profile, space memory (rules for every project) and this project\'s memory, with node ids, revisions, update dates and body sizes. Use it to see what is remembered and where a new fact belongs before memory_write.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        scopes: { type: 'array', uniqueItems: true, items: SCOPE_SCHEMA, description: 'Scopes to list; defaults to all.' },
        section: { type: 'string', description: 'Section key or H1 title to list.' },
        pathPrefix: { type: 'string', description: 'Title path prefix, segments separated by `/`.' },
        depth: { type: 'integer', minimum: 1, maximum: MAX_NODE_LEVEL, description: 'Deepest heading level listed; defaults to all.' },
      },
    },
  },
  search: {
    name: 'memory_search',
    description: 'Search long-term memory nodes with several patterns combined with OR (regex unless fixedStrings; case-insensitive by default), optionally limited to scopes, a section or a title path prefix; or read nodes by id. Each result is a whole node: scope, title path, id, revision, update time and body, with matching lines prefixed by `>> `. Catalog lines injected at session start are titles only: read the node before relying on it or changing it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        patterns: { type: 'array', maxItems: MAX_SEARCH_PATTERNS, items: { type: 'string', minLength: 1 }, description: 'Patterns combined with OR; include synonyms and other languages. Mutually exclusive with ids.' },
        fixedStrings: { type: 'boolean', description: 'Match patterns as literal text.' },
        ignoreCase: { type: 'boolean', description: 'Case-insensitive matching; defaults to true.' },
        scopes: { type: 'array', uniqueItems: true, items: SCOPE_SCHEMA, description: 'Scopes to search; defaults to all.' },
        section: { type: 'string', description: 'Section key or H1 title filter.' },
        pathPrefix: { type: 'string', description: 'Title path prefix filter, segments separated by `/`.' },
        ids: { type: 'array', items: { type: 'string' }, description: 'Node ids to read whole. Mutually exclusive with patterns.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_LIMIT, description: 'Nodes per page.' },
        cursor: { type: 'string', description: 'Cursor from a previous result: the next result page, or the next body page of a single id.' },
      },
    },
  },
  write: {
    name: 'memory_write',
    description: `Change long-term memory with 1 to ${MAX_OPERATIONS_PER_WRITE} operations applied all-or-nothing: create, replace, append, rename, move (across scopes and sections too) and delete. create needs a scope and exactly one of parentId, section or newSection. Every action except create needs the node's current expectedRevision from memory_search or memory_outline. Scopes: \`user\` describes who the user is; \`space\` holds rules and environment that hold for every project; \`project\` holds facts, decisions and constraints of this project only. The \`base\` section of space and project is injected in full every session, so keep it to a few critical, stable rules and put the rest in other sections. Write when the user asks you to remember something, corrects your approach, or a decision is made that the repository does not show. Make titles state the fact itself; bodies cannot contain H1-H4 headings.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operations: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_OPERATIONS_PER_WRITE,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              action: { type: 'string', enum: ['create', 'replace', 'append', 'rename', 'move', 'delete'] },
              id: { type: 'string', description: 'Node id; every action except create.' },
              expectedRevision: { type: 'string', description: 'Revision last read; every action except create.' },
              scope: { type: 'string', enum: [...SCOPES], description: 'Destination scope; required for create, optional for move.' },
              parentId: { type: 'string', description: 'create/move: become the last child of this node.' },
              section: { type: 'string', description: `create/move: become a child of this section, by key or H1 title. New files start with the preset sections: ${presetSectionKeys()}.` },
              newSection: { type: 'boolean', description: 'create/move: become a new H1 section. Give exactly one of parentId, section, newSection.' },
              title: { type: 'string', description: 'create/rename: heading text.' },
              body: { type: 'string', description: 'create/replace: Markdown body. replace keeps the title; change it with rename.' },
              text: { type: 'string', description: 'append: Markdown appended after a blank line.' },
              withChildren: { type: 'boolean', description: 'delete: also delete child nodes.' },
            },
            required: ['action'],
          },
        },
      },
      required: ['operations'],
    },
  },
} as const

function invalidArguments(message: string): MemoryError {
  return MemoryError.invalid(`Invalid arguments: ${message}`)
}

/** An object with only the known fields, as serde's `deny_unknown_fields` requires. */
function expectObject(args: unknown, fields: readonly string[]): Record<string, unknown> {
  const input = args === undefined || args === null ? {} : args
  if (!isRecord(input)) throw invalidArguments('expected an object')
  const unknown = Object.keys(input).find(key => !fields.includes(key))
  if (unknown !== undefined) throw invalidArguments(`unknown field \`${unknown}\`, expected one of ${fields.map(field => `\`${field}\``).join(', ')}`)
  return input
}

function optionalString(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw invalidArguments(`\`${field}\` must be a string`)
  return value
}

function optionalBoolean(input: Record<string, unknown>, field: string): boolean | undefined {
  const value = input[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw invalidArguments(`\`${field}\` must be a boolean`)
  return value
}

function optionalInteger(input: Record<string, unknown>, field: string): number | undefined {
  const value = input[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalidArguments(`\`${field}\` must be a non-negative integer`)
  return value
}

function stringList(input: Record<string, unknown>, field: string): string[] | undefined {
  const value = input[field]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw invalidArguments(`\`${field}\` must be an array of strings`)
  return value
}

function scopeList(input: Record<string, unknown>): MemoryScope[] | undefined {
  const value = input['scopes']
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || !value.every(isScope)) throw invalidArguments('`scopes` must be an array of user, space or project')
  return value
}

/** Copy the defined values only, so optional request fields stay absent. */
function defined<T extends object>(value: { [K in keyof T]: T[K] | undefined }): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

export function parseOutlineRequest(args: unknown): OutlineRequest {
  const input = expectObject(args, ['scopes', 'section', 'pathPrefix', 'depth'])
  return defined<OutlineRequest>({
    scopes: scopeList(input),
    section: optionalString(input, 'section'),
    pathPrefix: optionalString(input, 'pathPrefix'),
    depth: optionalInteger(input, 'depth'),
  })
}

export function parseSearchRequest(args: unknown): SearchRequest {
  const input = expectObject(args, ['patterns', 'fixedStrings', 'ignoreCase', 'scopes', 'section', 'pathPrefix', 'ids', 'limit', 'cursor'])
  return defined<SearchRequest>({
    patterns: stringList(input, 'patterns'),
    fixedStrings: optionalBoolean(input, 'fixedStrings'),
    ignoreCase: optionalBoolean(input, 'ignoreCase'),
    scopes: scopeList(input),
    section: optionalString(input, 'section'),
    pathPrefix: optionalString(input, 'pathPrefix'),
    ids: stringList(input, 'ids'),
    limit: optionalInteger(input, 'limit'),
    cursor: optionalString(input, 'cursor'),
  })
}
