/**
 * LuaSkills entries as dsh tools, named and filled in the way VulcanCode does: the canonical
 * name lowercased with every other character turned into `_`, at most 64 characters, and `ls_` in
 * front when dsh already has a tool of that name. The session id and working directory are filled
 * in by the Host and hidden from the model.
 */

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { RESULT_BUDGET_BYTES } from './constants.js'
import type { EntryDescriptor, InvocationResult } from './protocol.js'

/** dsh and DeepSeek function names: at most 64 characters. */
const MAX_TOOL_NAME = 64
/** Arguments the Host fills in; the model never sees them. */
export const SESSION_FIELD = 'LUASKILL_SID'
export const DIRECTORY_FIELD = 'PWD'
const HIDDEN_FIELDS = [SESSION_FIELD, DIRECTORY_FIELD]

export function toolName(canonical: string, taken: (name: string) => boolean): string {
  const base = canonical.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, MAX_TOOL_NAME)
  return taken(base) ? `ls_${base}`.slice(0, MAX_TOOL_NAME) : base
}

/** The entry's schema without the Host-filled fields, and which of them it declares. */
export function modelSchema(schema: unknown): { parameters: Record<string, unknown>; session: boolean; directory: boolean } {
  const source = isRecord(schema) ? schema : {}
  const properties = isRecord(source['properties']) ? { ...source['properties'] } : {}
  const session = SESSION_FIELD in properties
  const directory = DIRECTORY_FIELD in properties
  for (const field of HIDDEN_FIELDS) delete properties[field]
  const required = Array.isArray(source['required'])
    ? (source['required'] as unknown[]).filter(name => typeof name === 'string' && !HIDDEN_FIELDS.includes(name))
    : undefined
  return {
    parameters: { ...source, type: 'object', properties, ...required === undefined ? {} : { required } },
    session,
    directory,
  }
}

/** The invocation context LuaSkills budgets and attributes a call by. */
export function invocationContext(tool: string, sessionId: string | undefined, dshVersion: string) {
  return {
    request_context: {
      request_id: `luaskills-tool:${tool}`,
      client_name: 'dsh',
      client_info: { kind: 'cli', name: 'dsh', version: dshVersion },
      ...sessionId === undefined ? {} : { session_id: sessionId },
    },
    client_budget: {
      client_name: 'dsh',
      tool_name: tool,
      matched_client_pattern: 'dsh',
      tool_result: { bytes: RESULT_BUDGET_BYTES, lines: -1 },
      file_read: { bytes: RESULT_BUDGET_BYTES, lines: -1 },
      tool_config: {},
    },
  }
}

/** What a skill call needs from the Host. */
export interface ToolHost {
  readonly dshVersion: string
  /** The session's working directory. */
  workingDirectory(exec: Parameters<ToolDefinition['execute']>[1]): Promise<string>
  call(canonical: string, args: Record<string, unknown>, context: unknown): Promise<InvocationResult>
}

/** The canonical value every LuaSkills tool returns. */
export interface SkillValue {
  readonly content: string
}

const OUTPUT: ToolDefinition['output'] = {
  schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'], additionalProperties: false },
  render: (_args, value) => [{ type: 'text', text: (value as unknown as SkillValue).content }],
}

export function skillTool(name: string, entry: EntryDescriptor, host: ToolHost): ToolDefinition {
  const { parameters, session, directory } = modelSchema(entry.input_schema)
  return {
    name,
    description: entry.description,
    parameters,
    output: OUTPUT,
    async execute(args, exec) {
      const input: Record<string, unknown> = isRecord(args) ? { ...args } : {}
      const sessionId = exec.agent?.id
      if (session) input[SESSION_FIELD] = `LUASKILLS-SID-${sessionId ?? 'none'}`
      if (directory) input[DIRECTORY_FIELD] = await host.workingDirectory(exec)
      const result = await host.call(entry.canonical_name, input, invocationContext(entry.canonical_name, sessionId, host.dshVersion))
      return { content: result.content } satisfies SkillValue
    },
  }
}

/** `luaskill_help`: a skill's main help or one of its topics, as listed in the skill catalog. */
export function helpTool(name: string, render: (skillId: string, flow: string | undefined) => Promise<string>): ToolDefinition {
  return {
    name,
    description: 'Read the help of one LuaSkills skill: its main guide, or one named topic of it. '
      + 'Call before first using a skill\'s tools when the skill catalog lists topics.',
    parameters: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'Skill id, as the skill catalog lists it.' },
        flow: { type: 'string', description: 'Topic name; omit for the main guide.' },
      },
      required: ['skill_id'],
      additionalProperties: false,
    },
    output: OUTPUT,
    async execute(args) {
      const input = isRecord(args) ? args : {}
      const skillId = input['skill_id']
      const flow = input['flow']
      if (typeof skillId !== 'string' || skillId === '') throw new Error('skill_id must be a non-empty string')
      if (flow !== undefined && typeof flow !== 'string') throw new Error('flow must be a string')
      return { content: await render(skillId, flow === '' ? undefined : flow) } satisfies SkillValue
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
