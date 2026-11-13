/**
 * `<dshHome>/vulcan-memory/settings.json`: the memory mode and the Markdown injection budget, the
 * same shape as VulcanCode's `settings.rs`. A missing file means Markdown mode with the default
 * budget and is never written back; only an explicit save writes it.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { MAX_PART_TOKENS, SETTINGS_FORMAT_VERSION } from './markdown/constants.js'
import { MemoryError } from './markdown/errors.js'
import { isRecord } from './markdown/registry.js'
import { writeAtomically } from './markdown/store.js'

/** The active memory backend, with Markdown as the default for existing installations.
 * 当前记忆后端，已有安装默认使用 Markdown。
 */
export type MemoryMode = 'off' | 'markdown' | 'sqlite'

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

// Identify the saved activation so old work cannot survive a switch away and back.
// 标识已保存的激活周期，避免旧任务跨越切出再切回的过程。
export interface SavedMemorySettings extends MemorySettings {
  readonly activation: string
}

export const DEFAULT_BUDGET: InjectionBudget = { user: 500, spaceBase: 400, projectBase: 600, spaceCatalog: 1_000, projectCatalog: 1_500 }
export const DEFAULT_SETTINGS: MemorySettings = { mode: 'markdown', budget: DEFAULT_BUDGET }
export const SETTINGS_FILE = 'settings.json'

const BUDGET_KEYS = ['user', 'spaceBase', 'projectBase', 'spaceCatalog', 'projectCatalog'] as const

export function loadSettings(memoryDirectory: string): SavedMemorySettings {
  const file = path.join(memoryDirectory, SETTINGS_FILE)
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_SETTINGS, activation: 'legacy:markdown' }
    throw MemoryError.io(file, 'read', error)
  }
  return parseSettings(text, file)
}

/** Save the requested mode and budget, retaining the activation only for the same mode.
 *  保存请求的模式及预算，仅在模式相同时保留激活标识。 */
export function saveSettings(memoryDirectory: string, settings: MemorySettings): void {
  validateSettings(settings)
  // A new mode gets a unique activation even if another instance missed the intermediate mode.
  // 新模式使用唯一激活标识，即使其他实例未观察到中间模式也能识别切换。
  let activation: string = randomUUID()
  try {
    const previous = loadSettings(memoryDirectory)
    if (previous.mode === settings.mode) activation = previous.activation
  } catch (error) {
    if (!(error instanceof MemoryError) || (error.kind !== 'json' && error.kind !== 'unsupported_format' && error.kind !== 'invalid')) throw error
  }
  writeAtomically(path.join(memoryDirectory, SETTINGS_FILE), `${JSON.stringify({
    version: SETTINGS_FORMAT_VERSION, mode: settings.mode, budget: settings.budget, activation,
  }, null, 2)}\n`)
}

export function parseSettings(text: string, file: string): SavedMemorySettings {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw MemoryError.json(file, error instanceof Error ? error.message : String(error))
  }
  if (!isRecord(value) || value['version'] !== SETTINGS_FORMAT_VERSION) {
    throw new MemoryError('unsupported_format', `Memory settings \`${file}\` must declare format version ${SETTINGS_FORMAT_VERSION}.`)
  }
  if (Object.keys(value).some(key => !['version', 'mode', 'budget', 'activation'].includes(key))) throw MemoryError.json(file, 'unknown settings field')
  // The retired VMM placeholder never stored data or injected memory, so its saved behavior is off.
  // 旧 VMM 占位模式从未存储或注入记忆，因此按原行为读取为关闭。
  const settings = { mode: value['mode'] === 'vmm' ? 'off' : value['mode'], budget: value['budget'] }
  validateSettings(settings, file)
  const activation = value['activation']
  if (activation !== undefined && (typeof activation !== 'string' || !/^(?:[a-f0-9-]{36}|legacy:(?:off|markdown|sqlite))$/.test(activation))) {
    throw MemoryError.json(file, 'invalid activation identifier')
  }
  return { ...settings, activation: activation ?? `legacy:${settings.mode}` }
}

/** Check the shape and that every budget part is a whole number of at most {@link MAX_PART_TOKENS}. */
export function validateSettings(settings: { mode: unknown; budget: unknown }, file = SETTINGS_FILE): asserts settings is MemorySettings {
  if (settings.mode !== 'off' && settings.mode !== 'markdown' && settings.mode !== 'sqlite') throw MemoryError.json(file, '`mode` must be off, markdown or sqlite')
  const budget = settings.budget
  if (!isRecord(budget) || Object.keys(budget).length !== BUDGET_KEYS.length
    || !BUDGET_KEYS.every(key => Number.isSafeInteger(budget[key]) && (budget[key] as number) >= 0)) {
    throw MemoryError.json(file, '`budget` must hold whole token counts for user, spaceBase, projectBase, spaceCatalog and projectCatalog')
  }
  if (BUDGET_KEYS.some(key => (budget[key] as number) > MAX_PART_TOKENS)) {
    throw MemoryError.invalid(`Each memory injection budget part must be at most ${MAX_PART_TOKENS} tokens.`)
  }
}
