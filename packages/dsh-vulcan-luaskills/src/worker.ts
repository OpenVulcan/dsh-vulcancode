/**
 * The LuaSkills worker process. The SDK calls LuaSkills synchronously through FFI, so it lives
 * here instead of on dsh's event loop, and in its own process so ending it unloads the core
 * library (see `engine.ts`). The SDK is imported from the runtime directory it was installed
 * into, named by the first argument as a `file:` URL; nothing in dsh's dependency tree provides it.
 *
 * Messages in: `{ id, method, params }`. Messages out: `{ id, ok, value | error }` answers and
 * `{ event: 'download', role, received, total }` while runtime archives download.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ManagedKind, WorkerEvent, WorkerReply, WorkerRequest } from './protocol.js'
import { inspectManaged, installManaged } from './managed-runtime.js'
import { installPreparedUnixRuntime, openUnixLuaSymbols, preparedUnixTarget, UNIX_NATIVE_SMOKE } from './unix-runtime.js'

/* eslint-disable @typescript-eslint/no-explicit-any -- the SDK is loaded at run time and has no types here. */
type Sdk = any
type Client = any

if (process.send === undefined) throw new Error('the LuaSkills worker must be started by the plugin')
// Without dsh there is nobody to answer; never linger as an orphan.
process.on('disconnect', () => { process.exit(0) })
// Keep the SDK URL for resolving its private Koffi installation.
// 保留 SDK 地址以解析其独立安装的 Koffi。
const sdkUrl = process.argv[2]!
const sdk: Sdk = await import(sdkUrl)

let client: Client | undefined
// Hold the global handle until the Worker exits, including when the SDK uses its own local handle.
// 在 Worker 退出前持有全局句柄，即使 SDK 另有局部句柄。
let unixSymbols: ReturnType<typeof openUnixLuaSymbols> | undefined
let roots: { name: string; skills_dir: string }[] = []

const post = (message: WorkerReply | WorkerEvent): void => { process.send!(message) }

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
  // Resolve or install a single interpreter under the selected LuaSkills slot.
  // 在选定的 LuaSkills 版本目录中检查或安装一个解释器。
  inspectManaged: (params: { runtimeRoot: string; luaRuntimeVersion: string }) =>
    inspectManaged(sdk, params.runtimeRoot, params.luaRuntimeVersion),
  installManaged: (params: { runtimeRoot: string; luaRuntimeVersion: string; kind: ManagedKind }) =>
    installManaged(sdk, params.runtimeRoot, params.luaRuntimeVersion, params.kind),
  async installRuntime(params: { runtimeRoot: string; luaskillsVersion: string; luaRuntimeVersion: string }) {
    // Unix archives are linked and signed when packing the plugin. No build tools run on the user's machine.
    // Unix 归档在打包插件时完成重链接和签名，用户设备无需运行构建工具。
    const target = preparedUnixTarget()
    if (target !== undefined) {
      await installPreparedUnixRuntime(target, params.runtimeRoot, sdk.embeddedContract.EMBEDDED_CONTRACT_SHA256)
      return null
    }
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
    unixSymbols?.unload()
    unixSymbols = undefined
    roots = sdk.RuntimeRoots.standard(params.runtimeRoot)
    // Only prepared Unix slots expose Lua symbols. Old installations can still serve as rollback targets.
    // 仅预处理后的 Unix 版本目录导出 Lua 符号，旧安装仍可用于回退。
    const prepared = preparedUnixTarget() !== undefined &&
      existsSync(path.join(params.runtimeRoot, 'resources', 'dsh-ffi-contract.sha256'))
    // Resolve only within this slot so LUASKILLS_LIB cannot swap out the verified core.
    // 只在当前版本目录解析核心库，避免 LUASKILLS_LIB 替换经过校验的核心。
    const libraryPath: string | null = prepared ? sdk.resolveLuaSkillsLibraryPathFromRuntime(params.runtimeRoot) : null
    if (prepared && libraryPath === null) throw new Error('The prepared LuaSkills core is missing.')
    if (libraryPath !== null) unixSymbols = openUnixLuaSymbols(libraryPath, sdkUrl)
    const created = sdk.LuaSkillsClient.create({
      runtimeRoot: params.runtimeRoot, poolConfig: params.poolConfig, hostOptions: params.hostOptions,
      ...(libraryPath === null ? {} : { libraryPath }),
    })
    try {
      created.loadFromRoots(roots)
      if (prepared && created.runLua(UNIX_NATIVE_SMOKE) !== true) throw new Error('LuaSkills native module verification failed.')
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
    unixSymbols?.unload()
    unixSymbols = undefined
    return null
  },
}

process.on('message', (request: WorkerRequest) => {
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
