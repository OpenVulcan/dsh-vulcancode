/** Messages between the Host plugin and its LuaSkills worker process. */

export interface WorkerRequest {
  readonly id: number
  readonly method: string
  readonly params: unknown
}

export type WorkerReply =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string }

export type WorkerEvent =
  | { readonly event: 'ready' }
  /** Bytes of one runtime archive so far; `total` is null when the server sent no length. */
  | { readonly event: 'download'; readonly role: string; readonly received: number; readonly total: number | null }

/** One skill entry as the SDK lists it; only the fields read here. */
export interface EntryDescriptor {
  readonly canonical_name: string
  readonly skill_id: string
  readonly local_name: string
  readonly root_name: string
  readonly description: string
  readonly input_schema: unknown
}

/** One help node of a skill. */
export interface HelpNode {
  readonly flow_name: string
  readonly description: string
  readonly related_entries: readonly string[]
  readonly is_main: boolean
}

/** One loaded skill's help, as the SDK lists it. */
export interface SkillHelp {
  readonly skill_id: string
  readonly skill_name: string
  readonly skill_version: string
  readonly root_name: string
  readonly main: HelpNode
  readonly flows: readonly HelpNode[]
}

export interface HelpDetail extends HelpNode {
  readonly skill_id: string
  readonly content: string
}

export interface InvocationResult {
  readonly content: string
  readonly overflow_mode?: string | null
}

/** Outcome of an install, update or uninstall. */
export interface ApplyResult {
  readonly skill_id: string
  readonly status: string
  readonly message: string
  readonly version?: string | null
}
