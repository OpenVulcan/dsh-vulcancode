// Public GitHub release origin, used for direct downloads and prefix mirrors.
// GitHub Release 的公开源站，用于直连和前缀镜像。
export const GITHUB = 'https://github.com'

// Built-in mirror names, addresses and regions match the LuaSkills mirror catalog used by VulcanCode.
// 内置镜像名称、地址和地区沿用 VulcanCode 使用的 LuaSkills 镜像目录。
export const GITHUB_MIRRORS = [
  { label: 'GitHub', region: 'global', base: GITHUB },
  { label: 'gh-proxy.com', region: 'cn', base: `https://gh-proxy.com/${GITHUB}` },
  { label: 'ghfast.top', region: 'cn', base: `https://ghfast.top/${GITHUB}` },
  { label: 'gh.llkk.cc', region: 'cn', base: `https://gh.llkk.cc/${GITHUB}` },
  { label: 'ghproxy.net', region: 'global', base: `https://ghproxy.net/${GITHUB}` },
] as const

// Probe a bounded sample of an actual archive to distinguish a working mirror from a landing page.
// 采样真实归档的有限字节，区分可用镜像和落地网页。
const SAMPLE_BYTES = 64 * 1024

/** Normalize GitHub download bases; a bare HTTPS origin becomes a prefix proxy.
 *  规范化 GitHub 下载基址；不带路径的 HTTPS 源地址视为前缀代理。 */
export function mirrorBase(value: string): string {
  const url = new URL(value.trim())
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Enter an HTTPS mirror address without credentials, query, or fragment.')
  }
  const pathname = url.pathname.replace(/\/+$/, '')
  return pathname !== '' ? url.origin + pathname : url.origin === GITHUB ? GITHUB : `${url.origin}/${GITHUB}`
}

/** Replace only the exact GitHub origin, preserving the asset path and query.
 *  仅替换准确的 GitHub 源站，保留资产路径和查询参数。 */
export function githubUrl(url: string, base: string): string {
  return new URL(url).origin === GITHUB ? base + url.slice(GITHUB.length) : url
}

/** The sampled result for one configured URL; null means it did not return an archive sample.
 *  单个地址的采样结果；空值代表未返回归档样本。 */
export interface MirrorProbe {
  readonly url: string
  readonly bytesPerSecond: number | null
}

/** Measure a range request end-to-end, including the connection and sampled data transfer.
 *  测量范围请求的全程速度，包含建立连接和传输采样数据。 */
async function probe(url: string, signal?: AbortSignal): Promise<MirrorProbe> {
  // Include both the operation's cancellation and a deadline for reading the response body.
  // 同时遵守操作取消信号和读取响应正文的截止时间。
  const deadline = AbortSignal.timeout(6_000)
  const started = performance.now()
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=0-${SAMPLE_BYTES - 1}` },
      signal: signal === undefined ? deadline : AbortSignal.any([deadline, signal]),
    })
    const reader = response.body?.getReader()
    if (reader === undefined) return { url, bytesPerSecond: null }
    try {
      if (!response.ok || /(?:text\/html|application\/(?:json|xml)|text\/plain)/i.test(response.headers.get('content-type') ?? '')) {
        return { url, bytesPerSecond: null }
      }
      let size = 0
      while (size < SAMPLE_BYTES) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
      }
      return { url, bytesPerSecond: size >= SAMPLE_BYTES ? Math.round(SAMPLE_BYTES * 1000 / Math.max(1, performance.now() - started)) : null }
    } finally {
      void reader.cancel().catch(() => {})
    }
  } catch {
    return { url, bytesPerSecond: null }
  }
}

/** Sample all supplied URLs in parallel and preserve the order of the input for display.
 *  并行采样所有给定地址，按输入顺序返回供界面显示。 */
export async function probeSources(urls: readonly string[], signal?: AbortSignal): Promise<MirrorProbe[]> {
  const results = await Promise.all(urls.map(url => probe(url, signal)))
  signal?.throwIfAborted()
  return results
}

/** Select the candidate with the highest measured speed; use the given source when no probe completes.
 *  选取实测速率最高的地址；测速全部未完成时使用给定源站尝试正常下载。 */
export async function fastestSource(urls: readonly string[], original: string, signal?: AbortSignal): Promise<string> {
  const results = await probeSources(urls, signal)
  return results.reduce<MirrorProbe>((best, item) =>
    item.bytesPerSecond !== null && item.bytesPerSecond > (best.bytesPerSecond ?? 0) ? item : best,
    { url: original, bytesPerSecond: null }).url
}

/** Return the configured GitHub mirror, or select one using the release asset being installed.
 *  返回指定 GitHub 镜像，或根据即将安装的发行资产测速选择。 */
export async function selectGitHubMirror(asset: string, configured: string | null, signal?: AbortSignal): Promise<string> {
  if (configured !== null) return mirrorBase(configured)
  const fastest = await fastestSource(GITHUB_MIRRORS.map(mirror => githubUrl(asset, mirror.base)), asset, signal)
  return GITHUB_MIRRORS.find(mirror => githubUrl(asset, mirror.base) === fastest)!.base
}
