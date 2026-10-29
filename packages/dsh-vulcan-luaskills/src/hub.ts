/**
 * Read-only LuaSkills Hub catalog, fetched by the Host for the LuaSkills page. Installing stays
 * inside LuaSkills through the `official_hub` source, against the same Hub base URL the engine
 * uses. Limits follow VulcanCode's Hub client.
 */

const PAGE_SIZE = 24
const MAX_QUERY_CHARS = 100
const MAX_CURSOR_CHARS = 12
const MAX_SKILL_ID_CHARS = 64
const MAX_LOCALE_CHARS = 35
const SEARCH_MAX_BYTES = 1024 * 1024
/** A translated README can exceed the original. */
const DETAIL_MAX_BYTES = 2 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000

export class HubError extends Error {
  constructor(message: string, readonly code = 'hub_failed') {
    super(message)
  }
}

export interface HubContent {
  readonly requested_locale?: string
  readonly locale?: string
  /** `original`, `translation`, or `original_fallback` while no translation exists. */
  readonly kind?: string
  readonly summary?: string
  readonly intro?: string
  readonly features?: readonly string[]
  readonly readme?: string | null
}

export interface HubSkill {
  readonly skill_id: string
  readonly publisher?: string
  readonly display_name?: string
  readonly summary?: string
  readonly repository_url?: string
  readonly homepage_url?: string
  readonly license?: string
  readonly tags?: readonly string[]
  readonly latest_version?: string
  readonly updated_at?: string
  readonly content?: HubContent | null
}

export interface HubPage {
  readonly hub: string
  readonly items: readonly HubSkill[]
  readonly nextCursor: string | null
}

export interface HubDetail {
  readonly hub: string
  readonly skill: HubSkill
  readonly original: HubContent | null
  readonly latest: { readonly version: string; readonly readme?: string; readonly published_at?: string }
}

function apiUrl(base: string, segments: readonly string[]): URL {
  let url: URL
  try {
    url = new URL(base.endsWith('/') ? base : `${base}/`)
  } catch {
    throw new HubError(`the LuaSkills Hub address ${base} is not a URL`, 'invalid_request')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/v1/${segments.map(encodeURIComponent).join('/')}`
  return url
}

function setLocale(url: URL, locale: string | null): void {
  if (locale === null || locale === '') return
  if (locale.length > MAX_LOCALE_CHARS) throw new HubError('the language code is too long', 'invalid_request')
  url.searchParams.set('lang', locale)
}

async function fetchJson(url: URL, maxBytes: number, what: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { accept: 'application/json' } })
  const text = await readCapped(response, maxBytes, what)
  if (!response.ok) {
    let message = text.slice(0, 200)
    try {
      const body = JSON.parse(text) as { error?: { code?: string; message?: string } }
      message = body.error?.message ?? message
    } catch {
      // Not JSON; the start of the text is the message.
    }
    throw new HubError(`LuaSkills Hub ${what} failed: HTTP ${response.status} ${message}`.trim())
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new HubError(`LuaSkills Hub returned an invalid ${what} response`)
  }
}

async function readCapped(response: Response, maxBytes: number, what: string): Promise<string> {
  if (response.body === null) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > maxBytes) throw new HubError(`LuaSkills Hub ${what} response is larger than ${maxBytes} bytes`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function searchHub(base: string, query: string, cursor: string | null, locale: string | null): Promise<HubPage> {
  const text = query.trim()
  if ([...text].length > MAX_QUERY_CHARS) throw new HubError(`the search text is longer than ${MAX_QUERY_CHARS} characters`, 'invalid_request')
  if (cursor !== null && cursor.length > MAX_CURSOR_CHARS) throw new HubError('the page cursor is not valid', 'invalid_request')
  const url = apiUrl(base, ['skills', 'search'])
  url.searchParams.set('limit', String(PAGE_SIZE))
  if (text !== '') url.searchParams.set('q', text)
  if (cursor !== null && cursor !== '') url.searchParams.set('cursor', cursor)
  setLocale(url, locale)
  const body = await fetchJson(url, SEARCH_MAX_BYTES, 'search') as { items?: unknown; next_cursor?: unknown }
  if (!Array.isArray(body.items) || !body.items.every(isSkill)) throw new HubError('LuaSkills Hub returned an invalid search response')
  return {
    hub: base.replace(/\/+$/, ''),
    items: body.items,
    nextCursor: typeof body.next_cursor === 'string' && body.next_cursor !== '' ? body.next_cursor : null,
  }
}

export async function hubSkill(base: string, skillId: string, locale: string | null): Promise<HubDetail> {
  const id = skillId.trim()
  if (id === '' || [...id].length > MAX_SKILL_ID_CHARS) {
    throw new HubError(`the skill id must be 1 to ${MAX_SKILL_ID_CHARS} characters`, 'invalid_request')
  }
  const url = apiUrl(base, ['skills', id])
  setLocale(url, locale)
  const body = await fetchJson(url, DETAIL_MAX_BYTES, 'skill detail') as { skill?: unknown; original?: unknown; latest?: unknown }
  const latest = body.latest as HubDetail['latest'] | undefined
  if (!isSkill(body.skill) || typeof latest?.version !== 'string') throw new HubError('LuaSkills Hub returned an invalid skill detail response')
  return {
    hub: base.replace(/\/+$/, ''),
    skill: body.skill,
    original: typeof body.original === 'object' && body.original !== null ? body.original as HubContent : null,
    latest,
  }
}

function isSkill(value: unknown): value is HubSkill {
  return typeof value === 'object' && value !== null && typeof (value as { skill_id?: unknown }).skill_id === 'string'
}
