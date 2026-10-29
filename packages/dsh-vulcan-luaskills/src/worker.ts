/**
 * The LuaSkills worker thread. The SDK calls LuaSkills synchronously through FFI, so it lives
 * here instead of on dsh's event loop. The SDK is imported from the runtime directory it was
 * installed into; nothing in dsh's own dependency tree provides it.
 *
 * Messages in: `{ id, method, params }`. Messages out: `{ id, ok, value | error }` answers and
 * `{ event: 'download', role, received, total }` while runtime archives download.
 */

import { parentPort, workerData } from 'node:worker_threads'

import type { WorkerData, WorkerEvent, WorkerReply, WorkerRequest } from './protocol.js'

/* eslint-disable @typescript-eslint/no-explicit-any -- the SDK is loaded at run time and has no types here. */
type Sdk = any
type Client = any

const port = parentPort!
const data = workerData as WorkerData
const sdk: Sdk = await import(data.sdkEntry)

let client: Client | undefined
let roots: { name: string; skills_dir: string }[] = []

const post = (message: WorkerReply | WorkerEvent): void => { port.postMessage(message) }

/** Report download bytes of the runtime archives, which the SDK fetches with the global `fetch`. */
function countDownloads(assets: Map<string, string>): () => void {
  const original = globalThis.fetch
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const response = await original(input, init)
    const url = input instanceof Request ? input.url : String(input)
    const role = assets.get(url)
    if (role === undefined || response.body === null) return response
    const header = Number(response.headers.get('content-length'))
    const total = Number.isSafeInteger(header) && header > 0 ? header : null
    let received = 0
    let reported = 0
    post({ event: 'download', role, received, total })
    const counted = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength
        // About every 256 KiB, so the page moves without flooding the Host.
        if (received - reported >= 262_144) {
          reported = received
          post({ event: 'download', role, received, total })
        }
        controller.enqueue(chunk)
      },
      flush() {
        post({ event: 'download', role, received, total })
      },
    }))
    return new Response(counted, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
  return () => { globalThis.fetch = original }
}

function engine(): Client {
  if (client === undefined) throw new Error('the LuaSkills engine is not started')
  return client
}

function root(name: string) {
  const found = roots.find(item => item.name === name)
  if (found === undefined) throw new Error(`no ${name} skill root`)
  return found
}

const SYSTEM = 'system'

const handlers: Record<string, (params: any) => unknown> = {
  async installRuntime(params: { runtimeRoot: string; luaskillsVersion: string; luaRuntimeVersion: string }) {
    const options = {
      runtimeRoot: params.runtimeRoot,
      database: 'none',
      luaskillsVersion: params.luaskillsVersion,
      luaRuntimeVersion: params.luaRuntimeVersion,
    }
    const plan = sdk.buildRuntimeInstallManifest(options)
    const assets = new Map<string, string>(plan.assets.map((asset: { download_url: string; role: string }) => [asset.download_url, asset.role]))
    const restore = countDownloads(assets)
    try {
      await sdk.installRuntimeAssets(options)
    } finally {
      restore()
    }
    return null
  },
  start(params: { runtimeRoot: string; poolConfig: object; hostOptions: object }) {
    client?.close()
    client = undefined
    roots = sdk.RuntimeRoots.standard(params.runtimeRoot)
    const created = sdk.LuaSkillsClient.create({ runtimeRoot: params.runtimeRoot, poolConfig: params.poolConfig, hostOptions: params.hostOptions })
    try {
      created.loadFromRoots(roots)
    } catch (error) {
      created.close()
      throw error
    }
    client = created
    return null
  },
  entries: () => engine().listEntries(SYSTEM),
  help: () => engine().listSkillHelp(SYSTEM),
  helpDetail: (params: { skillId: string; flow?: string }) => engine().renderSkillHelpDetail(params.skillId, params.flow, { authority: SYSTEM }),
  call: (params: { name: string; args: unknown; context: unknown }) => engine().callSkill(params.name, params.args, params.context),
  install(params: { root: string; request: object }) {
    const result = engine().system(SYSTEM).install(roots, params.request, { targetRoot: root(params.root), authority: SYSTEM })
    engine().reloadFromRoots(roots)
    return result
  },
  update(params: { root: string; request: object }) {
    const result = engine().system(SYSTEM).update(roots, params.request, { targetRoot: root(params.root), authority: SYSTEM })
    engine().reloadFromRoots(roots)
    return result
  },
  uninstall(params: { root: string; skillId: string }) {
    const result = engine().system(SYSTEM).uninstall(roots, params.skillId, {}, { targetRoot: root(params.root), authority: SYSTEM })
    engine().reloadFromRoots(roots)
    return result
  },
  setEnabled(params: { skillId: string; enabled: boolean }) {
    const system = engine().system(SYSTEM)
    return params.enabled ? system.enable(roots, params.skillId) : system.disable(roots, params.skillId, 'disabled in dsh')
  },
  stop() {
    client?.close()
    client = undefined
    return null
  },
}

port.on('message', (request: WorkerRequest) => {
  void (async () => {
    try {
      const handler = handlers[request.method]
      if (handler === undefined) throw new Error(`unknown worker method ${request.method}`)
      const value = await handler(request.params)
      post({ id: request.id, ok: true, value: value ?? null })
    } catch (error) {
      post({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })()
})
post({ event: 'ready' })
