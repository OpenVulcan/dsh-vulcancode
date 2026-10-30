/** The three memory scopes and their preset sections (`scope.rs`). */

export type MemoryScope = 'user' | 'space' | 'project'

/** Every scope in display order. */
export const SCOPES: readonly MemoryScope[] = ['user', 'space', 'project']

/** Stable key of the base section injected in full for space and project. */
export const BASE_SECTION_KEY = 'base'

export function isScope(value: unknown): value is MemoryScope {
  return value === 'user' || value === 'space' || value === 'project'
}

/** Conflict priority; higher wins (project > space > user). */
export function scopePriority(scope: MemoryScope): number {
  return SCOPES.indexOf(scope)
}

/** Whether the scope separates an injected base section from a catalog. */
export function hasBaseSection(scope: MemoryScope): boolean {
  return scope !== 'user'
}

/** `[key, default title]` of the sections a new file of the scope starts with. */
export function presetSections(scope: MemoryScope): readonly (readonly [string, string])[] {
  switch (scope) {
    case 'user': return [['identity', 'Identity'], ['communication', 'Communication'], ['expertise', 'Expertise']]
    case 'space': return [[BASE_SECTION_KEY, 'Base'], ['conventions', 'Conventions'], ['environment', 'Environment'], ['references', 'References']]
    case 'project': return [[BASE_SECTION_KEY, 'Base'], ['architecture', 'Architecture'], ['constraints', 'Constraints'], ['pitfalls', 'Pitfalls'], ['in-progress', 'In progress']]
  }
}
