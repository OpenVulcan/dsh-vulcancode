/**
 * The Host side of the LuaSkills worker: one request at a time per call site, answered by id.
 * The worker owns every SDK call; when it exits, every pending request fails with the reason.
 */

import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

import type {
  ApplyResult, EntryDescriptor, HelpDetail, InvocationResult, SkillHelp, WorkerData, WorkerEvent, WorkerReply,
} from './protocol.js'

export type DownloadListener = (role: string, received: number, total: number | null) => void

export class LuaSkillsWorker {
  private readonly worker: Worker
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  private next = 0
  private exitError: Error | undefined
  /** Set once the Host asked the worker to stop; its exit is then not a crash. */
  private stopping = false
  private readonly started: Promise<void>
  /** Set while a runtime install reports its downloads. */
  onDownload: DownloadListener | undefined

  /**
   * @param sdkEntry - absolute path of the SDK's entry module.
   * @param onExit - called once if the worker stops without being asked to.
   */
  constructor(sdkEntry: string, private readonly onExit: (error: Error) => void) {
    const data: WorkerData = { sdkEntry: pathToFileURL(sdkEntry).href }
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: data })
    let ready: () => void
    let failed: (error: Error) => void
    this.started = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject })
    this.started.catch(() => {})
    this.worker.on('message', (message: WorkerReply | WorkerEvent) => {
      if ('event' in message) {
        if (message.event === 'ready') ready()
        else this.onDownload?.(message.role, message.received, message.total)
        return
      }
      const waiter = this.pending.get(message.id)
      if (waiter === undefined) return
      this.pending.delete(message.id)
      if (message.ok) waiter.resolve(message.value)
      else waiter.reject(new Error(message.error))
    })
    // A failed SDK import surfaces as `error` or `exit` before `ready`; settling `started` twice is a no-op.
    this.worker.on('error', (error) => {
      failed(error)
      this.fail(error)
    })
    this.worker.on('exit', (code) => {
      const error = new Error(`the LuaSkills worker stopped (exit code ${code})`)
      failed(error)
      this.fail(error)
    })
  }

  private fail(error: Error): void {
    if (this.exitError !== undefined) return
    this.exitError = this.stopping ? new Error('the LuaSkills worker was stopped') : error
    for (const waiter of this.pending.values()) waiter.reject(this.exitError)
    this.pending.clear()
    if (!this.stopping) this.onExit(error)
  }

  private async request<T>(method: string, params: unknown = null, internal = false): Promise<T> {
    await this.started
    if (this.exitError !== undefined) throw this.exitError
    if (this.stopping && !internal) throw new Error('the LuaSkills worker is stopping')
    const id = ++this.next
    return await new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.worker.postMessage({ id, method, params })
    })
  }

  installRuntime(params: { runtimeRoot: string; luaskillsVersion: string; luaRuntimeVersion: string }): Promise<void> {
    return this.request('installRuntime', params)
  }

  start(params: { runtimeRoot: string; poolConfig: object; hostOptions: object }): Promise<void> {
    return this.request('start', params)
  }

  entries(): Promise<EntryDescriptor[]> {
    return this.request('entries')
  }

  help(): Promise<SkillHelp[]> {
    return this.request('help')
  }

  helpDetail(skillId: string, flow?: string): Promise<HelpDetail | null> {
    return this.request('helpDetail', { skillId, ...flow === undefined ? {} : { flow } })
  }

  call(name: string, args: unknown, context: unknown): Promise<InvocationResult> {
    return this.request('call', { name, args, context })
  }

  install(root: string, request: object): Promise<ApplyResult> {
    return this.request('install', { root, request })
  }

  update(root: string, request: object): Promise<ApplyResult> {
    return this.request('update', { root, request })
  }

  uninstall(root: string, skillId: string): Promise<ApplyResult> {
    return this.request('uninstall', { root, skillId })
  }

  setEnabled(skillId: string, enabled: boolean): Promise<unknown> {
    return this.request('setEnabled', { skillId, enabled })
  }

  /** Close the engine, then the thread; nothing is reported as a crash. */
  async stop(): Promise<void> {
    this.stopping = true
    // A call still running holds the engine; it gets a few seconds before the thread is ended.
    await Promise.race([
      this.request('stop', null, true),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ]).catch(() => {})
    await this.worker.terminate()
  }

  /** Stop at once, abandoning whatever the worker is doing. */
  async kill(): Promise<void> {
    this.stopping = true
    await this.worker.terminate()
  }
}
