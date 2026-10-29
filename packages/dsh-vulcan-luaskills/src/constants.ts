/**
 * The exact LuaSkills artifacts this plugin installs. Each fact is defined here once; the
 * installer, the engine and the pages read it from this module.
 */

/** One npm package installed into the runtime's own `node_modules`, checked by its lockfile integrity. */
export interface PinnedPackage {
  readonly name: string
  readonly version: string
  readonly tarball: string
  /** Subresource integrity (`sha512-…`) published by the npm registry. */
  readonly integrity: string
}

/** The Node SDK and its one dependency. Koffi ships prebuilt binaries, so no install script runs. */
export const SDK_PACKAGES: readonly PinnedPackage[] = [
  {
    name: '@luaskills/sdk',
    version: '0.6.7',
    tarball: 'https://registry.npmjs.org/@luaskills/sdk/-/sdk-0.6.7.tgz',
    integrity: 'sha512-1yEvpMiPiEDDZK3/z1Deq3Hq7fb/SBaznObFjareUyBWoWCurT5jSHpzgex3ioyHnB3i6mXkrfvpukcEoN866Q==',
  },
  {
    name: 'koffi',
    version: '2.16.3',
    tarball: 'https://registry.npmjs.org/koffi/-/koffi-2.16.3.tgz',
    integrity: 'sha512-E9y1AsgYGlaxMhcZzHr8y96QF2U5XzA12GGVAfbWqIubTwPNMXQarfBzePNXHe0xtIEtNd6ifAv3GAKYGUeBAQ==',
  },
]

/** The SDK package the engine imports. */
export const SDK_PACKAGE = SDK_PACKAGES[0]!

/** LuaSkills core (JSON FFI) release; also the SDK 0.6.7 default. */
export const LUASKILLS_VERSION = 'v0.7.2'

/**
 * Lua runtime packages release. Pinned, because the SDK otherwise asks the GitHub API for the
 * newest release of the series on every install.
 */
export const LUA_RUNTIME_VERSION = 'v0.1.8'

/** Roughly what the runtime takes on disk once installed, for the install prompt. */
export const RUNTIME_SIZE_MB = 190

/** The default skill, installed into the ROOT layer with the runtime; it can be disabled, not removed. */
export const DEFAULT_SKILL = { skillId: 'vulcan-codekit', source: 'LuaSkills/vulcan-codekit', sourceType: 'github' } as const

/**
 * Codekit entries that only read. Every other LuaSkills entry may change files and follows the
 * session's sandbox mode.
 */
export const READ_ONLY_ENTRIES: ReadonlySet<string> = new Set([
  'vulcan-codekit-repo-map',
  'vulcan-codekit-ast-detail',
  'vulcan-codekit-ast-tree',
  'vulcan-codekit-rg',
  'vulcan-codekit-markdown-menu',
  'vulcan-codekit-node-source',
])

/** The two LuaSkills Hub sites; the China site is a read-only mirror. */
export const HUB_SITES = [
  { site: 'global', url: 'https://hub.luaskills.com' },
  { site: 'cn', url: 'https://hub.luaskills.cn' },
] as const

/** Budget every skill call is given; matches VulcanCode's inline tool result limit. */
export const RESULT_BUDGET_BYTES = 200_000
