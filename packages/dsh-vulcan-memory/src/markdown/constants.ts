/**
 * Limits of Markdown memory, the same as VulcanCode's `vulcan-markdown-memory` crate
 * (`crates/vulcan-markdown-memory/src/lib.rs`, `settings.rs`). Byte limits count UTF-8 bytes.
 */

export const MAX_NODE_LEVEL = 4
export const MAX_TITLE_CHARS = 120
export const MAX_NODE_BODY_BYTES = 16 * 1024
export const MAX_FILE_BYTES = 512 * 1024
export const MAX_OPERATIONS_PER_WRITE = 16
export const MAX_SEARCH_PATTERNS = 12
export const DEFAULT_SEARCH_LIMIT = 6
export const MAX_SEARCH_LIMIT = 20
export const NODE_PAGE_BYTES = 6 * 1024
export const BUDGET_WARNING_PERCENT = 80
export const MAX_PART_TOKENS = 16_000
export const REGISTRY_FORMAT_VERSION = 1
export const SETTINGS_FORMAT_VERSION = 1
export const MAX_PACKAGE_PROJECTS = 256
/** The manifest, user and space entries plus every project, each at most a whole file. */
export const MAX_PACKAGE_BYTES = (MAX_PACKAGE_PROJECTS + 3) * MAX_FILE_BYTES
export const EXPORT_FORMAT_VERSION = 1

/** UTF-8 byte length, which every Rust `str::len` limit counts. */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}
