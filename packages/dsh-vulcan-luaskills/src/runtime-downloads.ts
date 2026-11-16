import { GITHUB, fastestSource, githubUrl } from '@openvulcan/dsh-runtime-download'

// Probe the pinned Windows core actually used by LuaSkills.
// 以 LuaSkills 实际使用的固定 Windows 核心测速。
export const LUA_MIRROR_SAMPLE = 'https://github.com/LuaSkills/luaskills/releases/download/v0.9.0/luaskills-ffi-sdk-windows-x64.tar.gz'

// Trusted release digests from the official GitHub and Node releases.
// 取自 GitHub 和 Node.js 官方发行版的可信摘要。
const GITHUB_SUMS: Readonly<Record<string, string>> = {
  '/astral-sh/uv/releases/download/0.11.28/uv-aarch64-apple-darwin.tar.gz': '33540eb7c883ab857eff79bd5ac2aa31fe27b595abecb4a9c003a2c998447232',
  '/astral-sh/uv/releases/download/0.11.28/uv-aarch64-unknown-linux-gnu.tar.gz': '03e9fe0a81b0718d0bc84625de3885df6cc3f89a8b6af6121d6b9f6113fb6533',
  '/astral-sh/uv/releases/download/0.11.28/uv-x86_64-apple-darwin.tar.gz': '2ad79983127ffca7d77b77ce6a24278d7e4f7b817a1acf72fea5f8124b4aac5e',
  '/astral-sh/uv/releases/download/0.11.28/uv-x86_64-pc-windows-msvc.zip': '0a23463216d09c6a72ff80ef5dc5a795f07dc1575cb84d24596c2f124a441b7b',
  '/astral-sh/uv/releases/download/0.11.28/uv-x86_64-unknown-linux-gnu.tar.gz': 'e490a6464492183c5d4534a5527fb4440f7f2bb2f228162ad7e4afe076dc0224',
  '/LuaSkills/luaskills-packages/releases/download/v0.1.8/lua-deps-windows-x64.tar.gz': '3514ef480f16dd0b28de359c341d5ba47153c62743be486d55b16069731d0889',
  '/LuaSkills/luaskills-packages/releases/download/v0.1.8/lua-runtime-packages-windows-x64.tar.gz': '4cbc303f69f7477f1a51b12ab62ee565efdb0509278dcb023f45290142c87a0d',
  '/LuaSkills/luaskills-packages/releases/download/v0.1.8/runtime-validation-windows-x64.tar.gz': '8fda4cd2b59d5efd22b81c33cc622340d6a24d71994cbc846d9fbbd0468202bf',
  '/LuaSkills/luaskills/releases/download/v0.9.0/luaskills-ffi-sdk-windows-x64.tar.gz': 'd0988a28b578e3ba0d48e98e3f1dfcac361fb0b3bf67f82922ed84e71f9c4768'
}
const NODE_SUMS = "e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1  node-v24.18.0-darwin-arm64.tar.gz\ndfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080  node-v24.18.0-darwin-x64.tar.gz\n58c9520501f6ae2b52d5b210444e24b9d0c029a58c5011b797bc1fe7105886f6  node-v24.18.0-linux-arm64.tar.xz\n55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742  node-v24.18.0-linux-x64.tar.xz\n0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821  node-v24.18.0-win-x64.zip"

// Pin pnpm transport metadata to the values published by the npm registry.
// 将 pnpm 传输元数据固定为 npm 官方注册表发布的值。
const PNPM = { dist: {
  tarball: 'https://registry.npmjs.org/pnpm/-/pnpm-11.11.0.tgz',
  integrity: 'sha512-RGP2X9gO2A1pvB1L8WPulPYFxzgPwxi7Wy6+FfjNEtScUaTVnpUbQB52TTtsp1HL9RvFDtcAGmvLSTXmhMNIgg==',
} }

/** GitHub download base and whether other asset providers are selected by speed.
 *  GitHub 下载基址，以及其他资产供应商是否按速度选择。 */
export interface RuntimeDownloadSource {
  readonly github: string
  readonly automatic: boolean
}

/** Select the official or regional transport for a pinned Node or npm asset.
 *  为固定的 Node 或 npm 资产选择官方或地区镜像传输地址。 */
export async function regionalAsset(asset: string, source: RuntimeDownloadSource, signal?: AbortSignal): Promise<string> {
  const url = new URL(asset)
  const mirror = url.origin === 'https://nodejs.org'
    ? 'https://registry.npmmirror.com/-/binary/node' + url.pathname.slice('/dist'.length)
    : 'https://registry.npmmirror.com' + url.pathname
  if (source.automatic) return fastestSource([asset, mirror], asset, signal)
  return source.github === GITHUB ? asset : mirror
}

/** Route the SDK's serial installation and restore the private Worker's environment.
 *  为 SDK 的串行安装配置镜像，结束后恢复独立 Worker 的环境。 */
export async function withRuntimeDownloads<T>(source: RuntimeDownloadSource, work: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  // Keep uv's embedded CPython checksum catalog and change only the download transport.
  // 保留 uv 内置的 CPython 摘要目录，仅改写下载传输路径。
  const overrides = {
    UV_PYTHON_INSTALL_MIRROR: githubUrl('https://github.com/astral-sh/python-build-standalone/releases/download', source.github),
    UV_PYTHON_DOWNLOADS_JSON_URL: undefined,
    UV_NO_CONFIG: '1',
  }
  const previous = Object.entries(overrides).map(([key, value]) => {
    const old = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
    return { key, old }
  })
  globalThis.fetch = async (input, init) => {
    // SDK 0.9 uses bare URL strings for pinned runtime asset requests.
    // SDK 0.9 使用纯 URL 字符串请求固定运行时资产。
    if (typeof input !== 'string') return original(input, init)
    const url = new URL(input)
    const options = { ...init, signal: AbortSignal.timeout(180_000) }
    if (url.origin === GITHUB) {
      const archive = url.pathname.replace(/\.sha256$/, '')
      const hash = GITHUB_SUMS[archive]
      if (hash === undefined) throw new Error('Unpinned LuaSkills release asset: ' + archive)
      return url.pathname.endsWith('.sha256') ? new Response(hash + '\n') : original(githubUrl(input, source.github), options)
    }
    if (url.origin === 'https://nodejs.org' && url.pathname.startsWith('/dist/v24.18.0/')) {
      if (url.pathname.endsWith('/SHASUMS256.txt')) return new Response(NODE_SUMS)
      return original(await regionalAsset(input, source), options)
    }
    if (input === 'https://registry.npmjs.org/pnpm/11.11.0') return Response.json(PNPM)
    if (input === PNPM.dist.tarball) return original(await regionalAsset(input, source), options)
    return original(input, init)
  }
  try {
    return await work()
  } finally {
    globalThis.fetch = original
    for (const { key, old } of previous) {
      if (old === undefined) delete process.env[key]
      else process.env[key] = old
    }
  }
}
