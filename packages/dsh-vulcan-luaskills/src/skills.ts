/**
 * What is installed in the ROOT and USER skill layers, read from the runtime's folders: the
 * skill folders themselves, their `skill.yaml` name and version, the install record and whether
 * the skill is disabled. Reading changes nothing.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

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
      const fields = topLevelScalars(readFileSync(manifest, 'utf8'))
      const record = path.join(state, 'installs', `${entry.name}.yaml`)
      const source = existsSync(record) ? installSource(readFileSync(record, 'utf8')) : undefined
      skills.push({
        skillId: entry.name,
        root: layer.root,
        name: fields.get('name') ?? entry.name,
        version: fields.get('version') ?? '',
        enabled: !existsSync(path.join(state, 'skills', 'disabled', `${entry.name}.json`)),
        ...source === undefined ? {} : { source },
      })
    }
  }
  return skills
}
