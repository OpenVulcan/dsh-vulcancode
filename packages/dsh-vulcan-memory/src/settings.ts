/**
 * `<dshHome>/vulcan-memory/settings.json`: the memory mode and the Markdown injection budget, the
 * same shape as VulcanCode's `settings.rs`. A missing file means Markdown mode with the default
 * budget and is never written back; only an explicit save writes it.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { MAX_PART_TOKENS, SETTINGS_FORMAT_VERSION } from './markdown/constants.js'
import { MemoryError } from './markdown/errors.js'
import { isRecord } from './markdown/registry.js'
import { writeAtomically } from './markdown/store.js'

/** `vmm` is a recognised mode with no implementation yet: nothing is registered or injected in it. */
export type MemoryMode = 'off' | 'markdown' | 'vmm'

export interface InjectionBudget {
  readonly user: number
  readonly spaceBase: number
  readonly projectBase: number
  readonly spaceCatalog: number
  readonly projectCatalog: number
}

export interface MemorySettings {
  readonly mode: MemoryMode
  readonly budget: InjectionBudget
}

export const DEFAULT_BUDGET: InjectionBudget = { user: 500, spaceBase: 400, projectBase: 600, spaceCatalog: 1_000, projectCatalog: 1_500 }
export const DEFAULT_SETTINGS: MemorySettings = { mode: 'markdown', budget: DEFAULT_BUDGET }
export const SETTINGS_FILE = 'settings.json'

const BUDGET_KEYS = ['user', 'spaceBase', 'projectBase', 'spaceCatalog', 'projectCatalog'] as const

export function loadSettings(memoryDirectory: string): MemorySettings {
  const file = path.join(memoryDirectory, SETTINGS_FILE)
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_SETTINGS
    throw MemoryError.io(file, 'read', error)
  }
  return parseSettings(text, file)
}

export function saveSettings(memoryDirectory: string, settings: MemorySettings): void {
  validateSettings(settings)
  writeAtomically(path.join(memoryDirectory, SETTINGS_FILE), `${JSON.stringify({ version: SETTINGS_FORMAT_VERSION, ...settings }, null, 2)}\n`)
}

export function parseSettings(text: string, file: string): MemorySettings {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw MemoryError.json(file, error instanceof Error ? error.message : String(error))
  }
  if (!isRecord(value) || value['version'] !== SETTINGS_FORMAT_VERSION) {
    throw new MemoryError('unsupported_format', `Memory settings \`${file}\` must declare format version ${SETTINGS_FORMAT_VERSION}.`)
  }
  if (Object.keys(value).some(key => !['version', 'mode', 'budget'].includes(key))) throw MemoryError.json(file, 'unknown settings field')
  const settings = { mode: value['mode'], budget: value['budget'] }
  validateSettings(settings, file)
  return settings
}

/** Check the shape and that every budget part is a whole number of at most {@link MAX_PART_TOKENS}. */
export function validateSettings(settings: { mode: unknown; budget: unknown }, file = SETTINGS_FILE): asserts settings is MemorySettings {
  if (settings.mode !== 'off' && settings.mode !== 'markdown' && settings.mode !== 'vmm') throw MemoryError.json(file, '`mode` must be off, markdown or vmm')
  const budget = settings.budget
  if (!isRecord(budget) || Object.keys(budget).length !== BUDGET_KEYS.length
    || !BUDGET_KEYS.every(key => Number.isSafeInteger(budget[key]) && (budget[key] as number) >= 0)) {
    throw MemoryError.json(file, '`budget` must hold whole token counts for user, spaceBase, projectBase, spaceCatalog and projectCatalog')
  }
  if (BUDGET_KEYS.some(key => (budget[key] as number) > MAX_PART_TOKENS)) {
    throw MemoryError.invalid(`Each memory injection budget part must be at most ${MAX_PART_TOKENS} tokens.`)
  }
}
