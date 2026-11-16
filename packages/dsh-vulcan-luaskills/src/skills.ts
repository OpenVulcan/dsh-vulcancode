/**
 * What is installed in the ROOT and USER skill layers, read from the runtime's folders: the
 * skill folders themselves, their `skill.yaml` name and version, the install record and whether
 * the skill is disabled. Reading changes nothing.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { mkdir, rm } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { parseDocument } from 'yaml'

/** The layers this plugin manages; PROJECT skills are left to the project. */
export const LAYERS = [
  { root: 'ROOT', folder: 'root_skills' },
  { root: 'USER', folder: 'user_skills' },
] as const
export type Layer = (typeof LAYERS)[number]['root']

export interface InstalledSkill {
  readonly skillId: string
  readonly root: Layer
  readonly name: string
  readonly version: string
  readonly enabled: boolean
  // The package introduction from skill.yaml's help.main.description.
  // 来自 skill.yaml 中 help.main.description 的包介绍。
  readonly description?: string
  /** Where it was installed from, when an install recorded it. */
  readonly source?: { readonly type: string; readonly locator: string }
}

/** Top-level `key: value` scalars of a small YAML document; nested blocks are skipped. */
export function topLevelScalars(text: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z_][\w-]*):[ \t]*(.*?)[ \t]*$/.exec(line)
    if (match === null || match[2] === '') continue
    values.set(match[1]!, match[2]!.replace(/^(['"])(.*)\1$/, '$2'))
  }
  return values
}

/** `source_type` and `locator` from the `source:` block of an install record. */
export function installSource(text: string): { type: string; locator: string } | undefined {
  const block = /^source:\r?\n((?:[ \t]+.*(?:\r?\n|$))+)/m.exec(text)?.[1]
  if (block === undefined) return undefined
  const fields = topLevelScalars(block.split(/\r?\n/).map(line => line.trim()).join('\n'))
  const type = fields.get('source_type')
  const locator = fields.get('locator')
  return type === undefined || locator === undefined ? undefined : { type, locator }
}

export function listInstalled(runtimeRoot: string): InstalledSkill[] {
  const state = path.join(runtimeRoot, 'state')
  const skills: InstalledSkill[] = []
  for (const layer of LAYERS) {
    const folder = path.join(runtimeRoot, layer.folder)
    if (!existsSync(folder)) continue
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifest = path.join(folder, entry.name, 'skill.yaml')
      if (!existsSync(manifest)) continue
      // Use the SDK's documented manifest fields, including multiline YAML descriptions.
      // 按 SDK 文档读取清单字段，同时支持 YAML 多行介绍。
      const yaml = readFileSync(manifest, 'utf8')
      const fields = topLevelScalars(yaml)
      const document = parseDocument(yaml)
      const description: unknown = document.errors.length === 0 ? document.getIn(['help', 'main', 'description']) : undefined
      const record = path.join(state, 'installs', `${entry.name}.yaml`)
      const source = existsSync(record) ? installSource(readFileSync(record, 'utf8')) : undefined
      skills.push({
        skillId: entry.name,
        root: layer.root,
        name: fields.get('name') ?? entry.name,
        version: fields.get('version') ?? '',
        ...(typeof description === 'string' && description.trim() !== '' ? { description: description.trim() } : {}),
        enabled: !existsSync(path.join(state, 'skills', 'disabled', `${entry.name}.json`)),
        ...source === undefined ? {} : { source },
      })
    }
  }
  return skills
}

/** Return the persisted Hub introduction for the installed skill, if one was recorded.
 *  返回已安装技能保存的 Hub 介绍，未保存时返回空值。 */
export function readHubSummary(runtimeRoot: string, id: string, version: string): string | undefined {
  try {
    const summary = JSON.parse(readFileSync(summaryPath(runtimeRoot, id), 'utf8')) as { version: string; description: string }
    return summary.version === version && typeof summary.description === 'string' ? summary.description : undefined
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Write or remove a Hub description without changing the SDK's installation metadata.
 *  保存或移除 Hub 介绍，无需改写 SDK 的安装元数据。 */
export async function saveHubSummary(runtimeRoot: string, id: string, version: string, summary: string | undefined): Promise<void> {
  const file = summaryPath(runtimeRoot, id)
  if (summary === undefined) {
    await rm(file, { force: true })
    return
  }
  await mkdir(path.dirname(file), { recursive: true })
  await writeFileAtomic(file, JSON.stringify({ version, description: summary }), { mode: 0o600 })
}

/** Resolve a Hub skill's local metadata file using its validated flat identifier.
 *  使用已校验的扁平标识解析 Hub 技能的本地元数据文件。 */
function summaryPath(runtimeRoot: string, id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new Error('Invalid Hub skill identifier.')
  return path.join(runtimeRoot, 'state', 'dsh-hub-summaries', `${id}.json`)
}
