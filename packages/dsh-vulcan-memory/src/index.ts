/**
 * Long-term Markdown memory in dsh, ported from VulcanCode. Three tools let the model read and
 * change memory; a snapshot of it enters each conversation once (and again after a compaction);
 * the memory-curator skill guides tidying. Files live under `<dshHome>/vulcan-memory`, in the same
 * formats as VulcanCode.
 *
 * The memory mode is read from `settings.json`: `markdown` (the default) enables everything here;
 * `off` and the not-yet-implemented `vmm` leave the tools refusing and inject nothing.
 *
 * The memory page (`client/`) reads and changes the same files through the routes below
 * {@link ROUTE_PREFIX}.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type { BUNDLED_SKILL_RANK, SkillCandidate, SkillProvider } from '@deepseek-ai/dsh-skill'
import type { PreToolDecision, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'

import { INITIAL_STATE, PROJECTION_KEY, SOURCE_KIND, applyEvent, injectionStateSchema, isSubagent, renderMemoryBlock } from './inject.js'
import { MemoryError } from './markdown/errors.js'
import * as markdown from './markdown/index.js'
import * as page from './page.js'
import { projectContext } from './project.js'
import { loadSettings } from './settings.js'

export type { MemoryMode, MemorySettings, InjectionBudget } from './settings.js'

export const name = 'vulcan-memory'
export const inject = ['tools', 'skills', 'agents', 'sessionProjections']
/** Mirrored by `ROUTE_BASE` in `client/shared.ts`. */
export const ROUTE_PREFIX = '/api/vulcan-memory/'

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const SKILL_NAME = 'memory-curator'
/** The standard rank of packaged skills; the type ties the literal to dsh's constant. */
const SKILL_RANK: typeof BUNDLED_SKILL_RANK = 600
const PROVIDER = 'vulcan-memory'

const OUTPUT: ToolDefinition['output'] = {
  schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'], additionalProperties: false },
  render: (_args, value) => [{ type: 'text', text: (value as { content: string }).content }],
}

export function apply(ctx: Context): void {
  const memoryDirectory = path.join(resolveDshHome(), 'vulcan-memory')
  const store = new markdown.MarkdownMemoryStore(memoryDirectory)
  const guide = readFileSync(path.join(ASSETS, 'markdown-memory-guide.md'), 'utf8')
  const skill = parseSkill(readFileSync(path.join(ASSETS, SKILL_NAME, 'SKILL.md'), 'utf8'))

  /** Memory of an agent's project, or `undefined` when memory is not active for it. */
  const access = (agent: Agent): markdown.MarkdownMemoryAccess | undefined =>
    markdown.resolveAccess(store, loadSettings(memoryDirectory), projectContext(agent.session.header.cwd))

  const tool = (spec: typeof markdown.TOOL_SPECS[keyof typeof markdown.TOOL_SPECS], run: (resolved: markdown.MarkdownMemoryAccess, args: unknown, agent: Agent) => string): ToolDefinition => ({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters as unknown as Record<string, unknown>,
    output: OUTPUT,
    async execute(args, { agent }) {
      if (agent === undefined) throw new Error('memory tools need a session')
      const resolved = access(agent)
      if (resolved === undefined) throw new Error(markdown.NOT_ACTIVE_MESSAGE)
      return { content: run(resolved, args, agent) }
    },
  })

  ctx.effect(() => ctx.tools.register(tool(markdown.TOOL_SPECS.outline, (resolved, args) => markdown.outline(resolved, args))))
  ctx.effect(() => ctx.tools.register(tool(markdown.TOOL_SPECS.search, (resolved, args) => markdown.search(resolved, args))))
  ctx.effect(() => ctx.tools.register(tool(markdown.TOOL_SPECS.write, (resolved, args, agent) =>
    markdown.write(resolved, { session: agent.id, source: 'ai' }, args))))

  // VulcanCode hides memory_write in Plan mode and forbids it for subagents; dsh keeps the tool
  // catalog stable, so the same rule is a refusal before the call runs.
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (exec.name !== markdown.TOOL_SPECS.write.name || exec.agent === undefined) return next()
    if (isSubagent(exec.agent.session.header)) {
      return { kind: 'deny', reason: 'Subagents cannot change long-term memory; report the fact to the parent conversation instead.' }
    }
    if (ctx.get('planMode')?.get(exec.agent).active === true) {
      return { kind: 'deny', reason: 'Plan mode is read-only: long-term memory cannot be changed until plan mode ends.' }
    }
    return next()
  })

  ctx.sessionProjections.register({
    key: PROJECTION_KEY,
    stateVersion: 1,
    stateSchema: injectionStateSchema,
    init: () => INITIAL_STATE,
    apply: applyEvent,
  })

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    if (isSubagent(agent.session.header)) return decision
    const state = ctx.sessionProjections.stateOf(agent.session, PROJECTION_KEY) ?? INITIAL_STATE
    if (state.injectedSeq !== null) return decision
    let text: string
    try {
      const resolved = access(agent)
      if (resolved === undefined) return decision
      text = renderMemoryBlock(guide, markdown.snapshot(resolved), state.compacted)
    } catch (error) {
      ctx.logger.warn(`cannot read long-term memory: ${error instanceof Error ? error.message : String(error)}`)
      return decision
    }
    return {
      ...decision,
      messages: [createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: SOURCE_KIND, form: 'snapshot', sections: [{ name: SOURCE_KIND, text }] },
      }), ...decision.messages],
    }
  }, { prepend: true })

  ctx.skills.registerProvider(() => {
    const provider: SkillProvider = {
      name: PROVIDER,
      list: () => Promise.resolve(loadSettings(memoryDirectory).mode !== 'markdown' ? [] : [{
        name: SKILL_NAME,
        description: skill.description,
        invocation: { modelInvocable: true, userInvocable: true },
        provider: PROVIDER,
        source: 'vulcan-memory',
        rank: SKILL_RANK,
        locator: SKILL_NAME,
      } satisfies SkillCandidate]),
      async get(candidate) {
        const { rank: _rank, locator: _locator, ...summary } = candidate
        return { ...summary, content: skill.body }
      },
    }
    return provider
  })

  ctx.inject(['connection', 'workspaceRegistry'], (child) => {
    const hosts = (): page.HostProject[] => child.workspaceRegistry.list().map(page.hostProjectOf)
    const routes: readonly (readonly ['GET' | 'POST', string, Handler])[] = [
      ['GET', 'overview', async (_request, url) => {
        const all = hosts()
        return page.loadOverview(store, all, page.resolveHost(all, param(url, 'projectId')), param(url, 'memoryProjectId'))
      }],
      ['POST', 'write', async (request) => {
        const input = page.fields(await readJson(request), ['projectId', 'memoryProjectId', 'operations'])
        const all = hosts()
        return page.writeAsUser(store, all, page.resolveHost(all, page.optionalText(input, 'projectId')), page.optionalText(input, 'memoryProjectId'), input['operations'])
      }],
      ['GET', 'file', async (_request, url) => page.readFile(store, page.scopeParam(url.searchParams.get('scope')), param(url, 'memoryProjectId'))],
      ['POST', 'file', async (request) => {
        const input = page.fields(await readJson(request), ['scope', 'memoryProjectId', 'expected', 'text'])
        return page.replaceFile(store, page.scopeParam(input['scope']), page.optionalText(input, 'memoryProjectId'), page.text(input, 'expected'), page.text(input, 'text'))
      }],
      ['POST', 'project', async (request) => {
        const action = page.parseProjectAction(await readJson(request))
        return page.applyProjectAction(store, page.resolveHost(hosts(), page.actionHostId(action)), action)
      }],
      ['GET', 'settings', async () => page.settingsView(loadSettings(memoryDirectory))],
      ['POST', 'settings', async (request) => {
        const settings = page.parseSettingsSave(await readJson(request))
        page.saveSettings(memoryDirectory, settings)
        return page.settingsView(settings)
      }],
      ['POST', 'export', async request => page.exportRequest(store, await readJson(request))],
      ['POST', 'import/preview', async request => page.previewRequest(store, await readJson(request))],
      ['POST', 'import', async request => page.importRequest(store, await readJson(request))],
    ]
    // dsh accepts one registration per exact path, so a path's methods share one route.
    for (const [route, byMethod] of groupRoutes(routes)) {
      child.effect(() => child.connection.fetch.register({
        path: `${ROUTE_PREFIX}${route}`,
        methods: [...byMethod.keys()],
        requestBody: 'buffered',
        fetch: request => handle(byMethod.get(request.method as 'GET' | 'POST') as Handler, request),
      }))
    }
  })
}

/** Fetch-shaped handler of one page route. */
type Handler = (request: Request, url: URL) => Promise<unknown>

/** Group route rows by path; dsh dispatches only the methods registered for a path. */
export function groupRoutes(
  routes: readonly (readonly ['GET' | 'POST', string, Handler])[],
): Map<string, Map<'GET' | 'POST', Handler>> {
  const grouped = new Map<string, Map<'GET' | 'POST', Handler>>()
  for (const [method, route, handler] of routes) {
    const byMethod = grouped.get(route) ?? new Map<'GET' | 'POST', Handler>()
    if (byMethod.has(method)) throw new Error(`vulcan-memory: ${method} ${route} is declared twice`)
    byMethod.set(method, handler)
    grouped.set(route, byMethod)
  }
  return grouped
}

function param(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  return value === null || value === '' ? undefined : value
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw MemoryError.invalid('The request body must be JSON.')
  }
}

const STATUS: Record<MemoryError['kind'], number> = {
  invalid: 400,
  unsupported_format: 400,
  project_unavailable: 400,
  not_found: 404,
  revision_mismatch: 409,
  concurrent_modification: 409,
  rollback_incomplete: 500,
  io: 500,
  json: 500,
}

/** Answer one page request; failures carry their kind and message, never a stack. */
export async function handle(handler: Handler, request: Request): Promise<Response> {
  try {
    const value = await handler(request, new URL(request.url))
    return Response.json({ ok: true, value: value ?? null }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    const code = error instanceof MemoryError ? error.kind : 'failed'
    const status = error instanceof MemoryError ? STATUS[error.kind] : 500
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ ok: false, error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } })
  }
}

/** Split a SKILL.md into its front-matter description and body. */
export function parseSkill(text: string): { description: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (match === null) throw new Error('memory-curator SKILL.md has no front matter')
  const description = /^description:\s*(.+)$/m.exec(match[1] ?? '')?.[1]?.trim()
  if (description === undefined || description === '') throw new Error('memory-curator SKILL.md has no description')
  return { description, body: text.slice(match[0].length).trim() }
}
