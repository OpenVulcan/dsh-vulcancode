/**
 * LuaSkills in dsh. The runtime is not part of this package: the user installs it from the
 * LuaSkills settings page, and from then on every enabled skill entry is a dsh tool, every
 * loaded skill is in dsh's skill catalog, and the page manages installed skills and the Hub.
 * The pages talk to the exact `/api/vulcan-luaskills/*` routes inside dsh's authenticated
 * connection.
 */

import path from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-client-connection'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { SkillCandidate, SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'

import { READ_ONLY_ENTRIES } from './constants.js'
import { HubError, hubSkill, searchHub } from './hub.js'
import type { EntryDescriptor, SkillHelp } from './protocol.js'
import { LuaSkillsRuntime, RuntimeError } from './runtime.js'
import { SettingsError } from './settings.js'
import { listInstalled, type InstalledSkill } from './skills.js'
import { helpTool, skillTool, toolName } from './tools.js'

export type { RuntimeState, RuntimeView } from './runtime.js'
export type { LuaSkillsSettings } from './settings.js'
export type { InstalledSkill } from './skills.js'

export const name = 'vulcan-luaskills'
export const inject = ['skills', 'tools', 'workingDirectory']

/** Prefix of every page route, below dsh's `/api`. Also restated in `client/shared.ts`. */
export const ROUTE_PREFIX = '/api/vulcan-luaskills/'

/** Skill catalog name of the help tool, as VulcanCode names it. */
const HELP_TOOL = 'luaskill_help'
/** Between user skills (400) and bundled ones (600): a user's own skill of the same name wins. */
const SKILL_RANK = 500
const PROVIDER = 'vulcan-luaskills'
/** dsh skill names are kebab-case. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** Hub skill ids are flat. */
const HUB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** An installed skill with whether the engine loaded it. */
export interface SkillRow extends InstalledSkill {
  readonly loaded: boolean
  readonly tools: readonly string[]
}

export function apply(ctx: Context): void {
  const dshVersion = getDshRuntimeVersion()
  const runtime = new LuaSkillsRuntime(path.join(resolveDshHome(), 'vulcan-luaskills'), () => { onChange() })

  let disposers: (() => void)[] = []
  /** dsh tool name → LuaSkills canonical name, for entries that may change files. */
  const writeTools = new Map<string, string>()
  /** Canonical name → dsh tool name, for the skill guides. */
  let toolNames = new Map<string, string>()
  let catalog: readonly SkillHelp[] = []
  let skillControl: SkillProviderControl | undefined
  let generation = 0
  let lastKind = runtime.current.kind

  const onChange = (): void => {
    const kind = runtime.current.kind
    if ((kind === 'ready') !== (lastKind === 'ready')) void refresh()
    lastKind = kind
  }

  /** Register the tools and catalog of the running engine, replacing the previous set whole. */
  const refresh = async (): Promise<void> => {
    const mine = ++generation
    let entries: EntryDescriptor[] = []
    let help: SkillHelp[] = []
    if (runtime.current.kind === 'ready') {
      try {
        const engine = runtime.engine()
        ;[entries, help] = await Promise.all([engine.entries(), engine.help()])
      } catch (error) {
        ctx.logger.warn(`cannot list LuaSkills entries: ${messageOf(error)}`)
      }
    }
    if (mine !== generation) return
    for (const dispose of disposers) dispose()
    disposers = []
    writeTools.clear()
    toolNames = new Map()
    catalog = help
    if (entries.length > 0 || help.length > 0) {
      const ours = new Set<string>()
      const taken = (candidate: string) => ours.has(candidate) || ctx.tools.get(candidate) !== undefined
      const register = (definition: Parameters<typeof ctx.tools.register>[0]): boolean => {
        try {
          disposers.push(ctx.tools.register(definition))
          ours.add(definition.name)
          return true
        } catch (error) {
          ctx.logger.warn(`cannot register the LuaSkills tool ${definition.name}: ${messageOf(error)}`)
          return false
        }
      }
      register(helpTool(toolName(HELP_TOOL, taken), (skillId, flow) => renderHelp(skillId, flow)))
      for (const entry of entries) {
        const tool = toolName(entry.canonical_name, taken)
        if (taken(tool)) {
          ctx.logger.warn(`the LuaSkills entry ${entry.canonical_name} has no free tool name`)
          continue
        }
        if (!register(skillTool(tool, entry, toolHost))) continue
        toolNames.set(entry.canonical_name, tool)
        if (!READ_ONLY_ENTRIES.has(entry.canonical_name)) writeTools.set(tool, entry.canonical_name)
      }
    }
    skillControl?.invalidate()
  }

  const toolHost = {
    dshVersion,
    workingDirectory: async (exec: ToolExecution) => {
      if (exec.agent === undefined) throw new Error('this LuaSkills tool needs a session')
      return await ctx.workingDirectory.ensure(exec.agent, exec.signal)
    },
    call: (canonical: string, args: Record<string, unknown>, context: unknown) => runtime.engine().call(canonical, args, context),
  }

  const renderHelp = async (skillId: string, flow: string | undefined): Promise<string> => {
    const detail = await runtime.engine().helpDetail(skillId, flow)
    if (detail === null) throw new Error(flow === undefined ? `no LuaSkills skill ${skillId}` : `the skill ${skillId} has no topic ${flow}`)
    return detail.content
  }

  /** A skill's guide for dsh's catalog: its main help, its topics, and its tools' dsh names. */
  const renderGuide = async (skillId: string): Promise<string> => {
    const help = catalog.find(item => item.skill_id === skillId)
    const parts = [await renderHelp(skillId, undefined)]
    const helpName = ctx.tools.get(HELP_TOOL) !== undefined ? HELP_TOOL : `ls_${HELP_TOOL}`
    const topics = help?.flows.filter(flow => !flow.is_main) ?? []
    if (topics.length > 0) {
      parts.push(`## Topics\n\nRead one with \`${helpName}\` (\`skill_id: "${skillId}"\`, \`flow\`):\n\n${topics.map(flow => `- \`${flow.flow_name}\`: ${flow.description}`).join('\n')}`)
    }
    const tools = [...toolNames].filter(([canonical]) => canonical.startsWith(`${skillId}-`))
    if (tools.length > 0) {
      parts.push(`## Tools\n\n${tools.map(([canonical, tool]) => `- \`${tool}\` (LuaSkills entry \`${canonical}\`)`).join('\n')}`)
    }
    return parts.join('\n\n')
  }

  ctx.skills.registerProvider((control) => {
    skillControl = control
    const provider: SkillProvider = {
      name: PROVIDER,
      list: () => Promise.resolve(catalog.filter(help => SKILL_NAME.test(help.skill_id)).map((help): SkillCandidate => ({
        name: help.skill_id,
        description: help.main.description,
        invocation: { modelInvocable: true, userInvocable: true },
        provider: PROVIDER,
        source: 'luaskills',
        rank: SKILL_RANK,
        locator: help.skill_id,
      }))),
      async get(candidate) {
        const { rank: _rank, locator, ...summary } = candidate
        return { ...summary, content: await renderGuide(locator as string) }
      },
    }
    return provider
  })

  // Entries that may change files follow the session's sandbox: refused when read-only, run
  // under full access, asked about otherwise.
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const canonical = writeTools.get(exec.name)
    if (canonical === undefined) return next()
    const session = exec.agent?.session
    const mode = ctx.get('sandboxPolicy')?.resolve(session === undefined ? {} : { session }).mode
    if (mode === 'read-only') {
      return { kind: 'deny', reason: `The LuaSkills tool ${exec.name} may change files, and this session's sandbox is read-only.` }
    }
    if (mode === 'danger-full-access') return next()
    const downstream = await next()
    if (downstream.kind !== 'allow') return downstream
    return {
      kind: 'ask',
      reason: `The LuaSkills entry ${canonical} may change files.`,
      displayReason: { en: `LuaSkills: ${canonical} may change files.`, zh: `LuaSkills：${canonical} 可能修改文件。` },
    }
  })

  const skillRows = async (): Promise<SkillRow[]> => {
    const installed = listInstalled(runtime.runtimeRoot)
    const loaded = new Set(catalog.map(help => help.skill_id))
    const tools = [...toolNames]
    return installed.map(skill => ({
      ...skill,
      loaded: loaded.has(skill.skillId),
      tools: tools.filter(([canonical]) => canonical.startsWith(`${skill.skillId}-`)).map(([, tool]) => tool),
    }))
  }

  const findSkill = (url: URL): InstalledSkill => {
    const id = url.searchParams.get('id') ?? ''
    const skill = listInstalled(runtime.runtimeRoot).find(item => item.skillId === id)
    if (skill === undefined) throw new RuntimeError(`no installed skill ${id}`, 'invalid_request')
    return skill
  }

  /** Run one skill change, then re-read the tools and catalog. */
  const mutate = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work()
    } finally {
      await refresh()
    }
  }

  const hubBase = () => runtime.settings.network.officialSkillHubBaseUrl
  const routes: readonly (readonly ['GET' | 'POST', string, Handler])[] = [
    ['GET', 'state', async () => runtime.view()],
    ['POST', 'install', async () => { runtime.install() }],
    ['POST', 'install/cancel', async () => { runtime.cancel() }],
    ['POST', 'remove', () => runtime.remove()],
    ['POST', 'restart', () => runtime.restart()],
    ['POST', 'settings', async request => runtime.saveSettings(await readJson(request))],
    ['GET', 'skills', () => skillRows()],
    ['POST', 'skills/enabled', async (_request, url) => {
      const skill = findSkill(url)
      const enabled = url.searchParams.get('enabled')
      if (enabled !== 'true' && enabled !== 'false') throw new RuntimeError('enabled must be true or false', 'invalid_request')
      return await mutate(() => runtime.engine().setEnabled(skill.skillId, enabled === 'true'))
    }],
    ['POST', 'skills/update', async (_request, url) => {
      const skill = findSkill(url)
      if (skill.source === undefined) throw new RuntimeError(`${skill.skillId} was not installed from a source it can be updated from`, 'invalid_request')
      const source = skill.source
      return await mutate(() => runtime.engine().update(skill.root, { skill_id: skill.skillId, source: source.locator, source_type: source.type }))
    }],
    ['POST', 'skills/uninstall', async (_request, url) => {
      const skill = findSkill(url)
      if (skill.root !== 'USER') throw new RuntimeError(`${skill.skillId} is a default skill; it can be disabled, not removed`, 'invalid_request')
      return await mutate(() => runtime.engine().uninstall('USER', skill.skillId))
    }],
    ['POST', 'skills/install', async (_request, url) => {
      const id = url.searchParams.get('id') ?? ''
      if (!HUB_ID.test(id)) throw new RuntimeError('id must be a LuaSkills Hub skill id', 'invalid_request')
      return await mutate(() => runtime.engine().install('USER', { skill_id: null, source: id, source_type: 'official_hub' }))
    }],
    ['GET', 'hub/search', async (_request, url) => searchHub(hubBase(), url.searchParams.get('q') ?? '', url.searchParams.get('cursor'), url.searchParams.get('lang'))],
    ['GET', 'hub/skill', async (_request, url) => hubSkill(hubBase(), url.searchParams.get('id') ?? '', url.searchParams.get('lang'))],
  ]

  ctx.inject(['connection'], (child) => {
    for (const [method, route, handler] of routes) {
      child.effect(() => child.connection.fetch.register({
        path: `${ROUTE_PREFIX}${route}`,
        methods: [method],
        requestBody: 'buffered',
        fetch: request => handle(handler, request),
      }))
    }
  })

  ctx.effect(() => {
    runtime.boot().catch((error: unknown) => { ctx.logger.warn(`cannot start LuaSkills: ${messageOf(error)}`) })
    return () => {
      generation++
      void runtime.close()
    }
  }, 'vulcan-luaskills: runtime')
}

/** Fetch-shaped handler of one page route. */
type Handler = (request: Request, url: URL) => Promise<unknown>

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new RuntimeError('the request body must be JSON', 'invalid_request')
  }
}

/** Answer one page request; failures carry their code, never a stack. */
export async function handle(handler: Handler, request: Request): Promise<Response> {
  try {
    const value = await handler(request, new URL(request.url))
    return Response.json({ ok: true, value: value ?? null }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    const code = error instanceof RuntimeError || error instanceof SettingsError || error instanceof HubError ? error.code : 'failed'
    const status = code === 'invalid_request' || code === 'invalid_settings' ? 400 : code === 'busy' ? 409 : code === 'not_ready' ? 503 : 500
    return Response.json({ ok: false, error: { code, message: messageOf(error) } }, { status, headers: { 'cache-control': 'no-store' } })
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
