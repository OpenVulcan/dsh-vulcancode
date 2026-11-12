/**
 * The local backend: keeps one worker process with the selected model loaded, restarts it when
 * the selection changes and stops it after a quiet period.
 */

import { DecisionError, checkResult, type JudgeInput, type ModelResult } from '../protocol.js'
import type { DecisionHome } from '../home.js'
import { backendOf, modelRoot, readModel } from './models.js'
import { installedPack, packPython, type PackId } from './packs.js'
import { WorkerProcess, type LoadResult } from './worker.js'

/** Which installed pack runs which installed model. */
export interface LocalSelection {
  readonly pack: PackId
  readonly model: string
}

/** One caller waiting for its inputs to be judged. */
interface Waiting {
  readonly selection: LocalSelection
  readonly inputs: readonly JudgeInput[]
  readonly resolve: (results: ModelResult[]) => void
  readonly reject: (error: unknown) => void
}

function selectionKey(selection: LocalSelection): string {
  return `${selection.pack}\n${selection.model}`
}

/** Split `inputs` into requests of at most `limit` inputs, in order; no limit means one request. */
export function mergeRequests<T>(inputs: readonly T[], limit: number | undefined): T[][] {
  const size = limit === undefined || limit < 1 ? Math.max(inputs.length, 1) : limit
  const requests: T[][] = []
  for (let start = 0; start < inputs.length; start += size) requests.push(inputs.slice(start, start + size))
  return requests
}

/** Hand each caller back its own slice of the merged results. */
export function splitResults<T>(groups: readonly (readonly unknown[])[], results: readonly T[]): T[][] {
  let offset = 0
  return groups.map(group => {
    const slice = results.slice(offset, offset + group.length)
    offset += group.length
    return slice
  })
}

/** Stop the process after this long without a judgement, to give its memory back. */
export const LOCAL_IDLE_MS = 30 * 60_000

export interface LocalStatus {
  readonly running: boolean
  readonly selection?: LocalSelection
  readonly loaded?: LoadResult
}

export class LocalEngine {
  private worker: WorkerProcess | undefined
  private current: { readonly key: string; readonly selection: LocalSelection; loading: Promise<LoadResult>; loaded?: LoadResult } | undefined
  private idleTimer: NodeJS.Timeout | undefined
  // Retain the exit promise until the worker has released the runtime files.
  // 在进程释放运行库文件前保留退出任务。
  private exiting: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private closed = false
  /** Loads and merged judgements run one at a time, in arrival order. */
  private queue: Promise<unknown> = Promise.resolve()
  /** Callers waiting for the next merged judgement. */
  private waiting: Waiting[] = []
  /** Whether a drain of `waiting` is already queued behind the running work. */
  private drainQueued = false

  constructor(private readonly home: DecisionHome, private readonly idleMs: number = LOCAL_IDLE_MS) {}

  status(): LocalStatus {
    return {
      running: this.worker?.running === true,
      ...this.current === undefined ? {} : { selection: this.current.selection },
      ...this.current?.loaded === undefined ? {} : { loaded: this.current.loaded },
    }
  }

  /**
   * Judge `inputs` with `selection`, loading it first when needed. Calls that arrive while the
   * worker is busy wait together and go out as one merged request, split into requests of at most
   * the package's `max_request_items` calls.
   */
  judge(selection: LocalSelection, inputs: readonly JudgeInput[]): Promise<ModelResult[]> {
    return new Promise((resolve, reject) => {
      this.assertOpen()
      this.waiting.push({ selection, inputs, resolve, reject })
      if (this.drainQueued) return
      this.drainQueued = true
      const run = this.queue.then(() => {
        this.drainQueued = false
        return this.drain()
      })
      this.queue = run.catch(() => {})
    })
  }

  /** Load the selected worker and start its idle period after loading completes.
   *  加载所选进程，并在加载完成后开始计算空闲时间。 */
  async warm(selection: LocalSelection): Promise<LoadResult> {
    const run = this.queue.then(async () => {
      clearTimeout(this.idleTimer)
      try {
        const loaded = await this.ensure(selection)
        this.assertOpen()
        return loaded
      } finally {
        this.armIdle()
      }
    })
    this.queue = run.catch(() => {})
    return await run
  }

  /** Stop the current worker and wait for exit. The engine can still load another worker.
   *  停止当前进程并等待退出。引擎仍可加载新的进程。 */
  stop(): Promise<void> {
    clearTimeout(this.idleTimer)
    const worker = this.worker
    this.worker = undefined
    this.current = undefined
    if (worker === undefined) return this.exiting ?? Promise.resolve()
    const exiting = worker.stop().finally(() => {
      if (this.exiting === exiting) this.exiting = undefined
    })
    this.exiting = exiting
    return exiting
  }

  /** Close permanently, reject queued requests, and await both the worker and active queue.
   *  永久关闭，拒绝排队请求，并等待进程和正在执行的队列结束。 */
  close(): Promise<void> {
    if (this.closing === undefined) {
      this.closed = true
      const error = new DecisionError('backend_unavailable', 'the local model engine is closed')
      for (const entry of this.waiting.splice(0)) entry.reject(error)
      this.closing = Promise.all([this.stop(), this.queue]).then(() => {})
    }
    return this.closing
  }

  /** Run a synchronous file change between requests after any matching worker has exited.
   *  在请求之间执行同步文件变更，并等待匹配的进程退出。 */
  async changeFiles<T>(matches: (selection: LocalSelection) => boolean, change: () => T): Promise<T> {
    const run = this.queue.then(async () => {
      this.assertOpen()
      if (this.current !== undefined && matches(this.current.selection)) await this.stop()
      else await this.exiting
      this.assertOpen()
      return change()
    })
    this.queue = run.catch(() => {})
    return await run
  }

  /** Reject work after the owning plugin or command has closed the engine.
   *  插件或命令关闭引擎后，拒绝继续执行请求。 */
  private assertOpen(): void {
    if (this.closed) throw new DecisionError('backend_unavailable', 'the local model engine is closed')
  }

  /** Drain one finite batch so arrivals during execution cannot keep file work waiting indefinitely.
   *  每次处理有限的一批请求，避免执行期间到达的新请求无限延迟文件操作。 */
  private async drain(): Promise<void> {
    let batch = this.waiting.splice(0)
    for (let first = batch[0]; first !== undefined; first = batch[0]) {
      const key = selectionKey(first.selection)
      const group = batch.filter(entry => selectionKey(entry.selection) === key)
      batch = batch.filter(entry => selectionKey(entry.selection) !== key)
      try {
        const results = await this.run(first.selection, group.map(entry => entry.inputs))
        group.forEach((entry, index) => entry.resolve(results[index] ?? []))
      } catch (error) {
        for (const entry of group) entry.reject(error)
      }
    }
  }

  /** Judge merged inputs without an idle timer running, and return one result list per caller.
   *  在空闲计时器停用时处理合并输入，并按调用者返回结果。 */
  private async run(selection: LocalSelection, groups: readonly (readonly JudgeInput[])[]): Promise<ModelResult[][]> {
    clearTimeout(this.idleTimer)
    try {
      const loaded = await this.ensure(selection)
      this.assertOpen()
      const worker = this.worker
      if (worker === undefined) throw new DecisionError('backend_unavailable', 'the local model process is not running')
      const flat = groups.flat()
      const results: ModelResult[] = []
      for (const request of mergeRequests(flat, loaded.limits?.max_request_items)) {
        const answered = await worker.judge(request)
        this.assertOpen()
        if (!Array.isArray(answered) || answered.length !== request.length) throw new DecisionError('model_failed', 'the local model did not answer every call')
        results.push(...answered.map(checkResult))
      }
      return splitResults(groups, results)
    } finally {
      this.armIdle()
    }
  }

  private async ensure(selection: LocalSelection): Promise<LoadResult> {
    this.assertOpen()
    const key = `${selection.pack}\n${selection.model}`
    if (this.current?.key === key && this.worker?.running === true) return await this.current.loading
    await this.stop()
    this.assertOpen()
    const pack = installedPack(this.home, selection.pack)
    if (pack === undefined) throw new DecisionError('not_installed', `the runtime pack ${selection.pack} is not installed`)
    const model = readModel(this.home, selection.model)
    if (model === undefined) throw new DecisionError('not_installed', `the model ${selection.model} is not installed`)
    if (backendOf(model.package_format) !== pack.backend) {
      throw new DecisionError('invalid_request', `${model.id} needs a ${backendOf(model.package_format)} runtime pack, not ${pack.pack}`)
    }
    const worker = new WorkerProcess(packPython(this.home, pack))
    this.worker = worker
    const current: NonNullable<typeof this.current> = {
      key, selection,
      loading: worker.load(model.package_format, modelRoot(this.home, model.id), pack.device),
    }
    this.current = current
    try {
      current.loaded = await current.loading
      return current.loaded
    } catch (error) {
      if (this.current === current) await this.stop()
      throw error
    }
  }

  /** Schedule cleanup only for a live worker with no judgement or load in progress.
   *  仅在进程仍存活且没有判定或加载操作时安排空闲清理。 */
  private armIdle(): void {
    clearTimeout(this.idleTimer)
    if (this.closed || this.worker?.running !== true) return
    this.idleTimer = setTimeout(() => { void this.stop() }, this.idleMs)
    this.idleTimer.unref()
  }
}
