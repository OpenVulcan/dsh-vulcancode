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

/** Interpreter families supported by the SDK's managed installer.
 * SDK 受管安装器支持的解释器类型。 */
export type ManagedKind = 'node' | 'python'

/** Report a managed interpreter and package manager in the current runtime slot.
 * 报告当前运行库版本中的受管解释器及包管理器。 */
export interface ManagedStatus {
  /** Interpreter or package manager build selected by the SDK.
   * SDK 选定的解释器和包管理器版本。 */
  readonly version: string
  readonly packageManagerVersion: string
  /** Absolute executable path when both the interpreter and package manager are present.
   * 解释器和包管理器均已安装时的绝对可执行文件路径。 */
  readonly executable: string | null
  /** Installation or validation error when the runtime could not be used.
   * 运行时不可用时的安装或校验错误。 */
  readonly error?: string
}

/** Display the SDK distribution root and the two runtime states.
 * 显示 SDK 发行目录及两个运行时的状态。 */
export interface ManagedView {
  readonly root: string
  readonly node: ManagedStatus
  readonly python: ManagedStatus
}

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
