/** Failures of the Markdown memory store; every message is English and safe to return to the model (`error.rs`). */

export type MemoryErrorKind =
  | 'invalid'
  | 'not_found'
  | 'revision_mismatch'
  | 'project_unavailable'
  | 'unsupported_format'
  | 'concurrent_modification'
  | 'rollback_incomplete'
  | 'io'
  | 'json'

export class MemoryError extends Error {
  constructor(readonly kind: MemoryErrorKind, message: string) {
    super(message)
    this.name = 'MemoryError'
  }

  static invalid(message: string): MemoryError {
    return new MemoryError('invalid', message)
  }

  static notFound(id: string): MemoryError {
    return new MemoryError('not_found', `Memory node \`${id}\` was not found; run memory_outline or memory_search to get current ids.`)
  }

  static revisionMismatch(id: string, expected: string, current: string): MemoryError {
    return new MemoryError('revision_mismatch', `Memory node \`${id}\` changed (expected revision ${expected}, current ${current}); read it again before writing.`)
  }

  static concurrent(path: string): MemoryError {
    return new MemoryError('concurrent_modification', `Memory file \`${path}\` changed on disk while the write was prepared; retry the write.`)
  }

  static io(path: string, action: string, cause: unknown): MemoryError {
    return new MemoryError('io', `Memory file \`${path}\` could not be ${action}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }

  static json(path: string, message: string): MemoryError {
    return new MemoryError('json', `Memory file \`${path}\` is not valid JSON: ${message}`)
  }

  /** One operation of a multi-operation write failed; nothing was written. */
  static operation(index: number, cause: MemoryError): MemoryError {
    return new MemoryError(cause.kind, `Operation #${index} (counting from 1) failed, so no change was written: ${cause.message}`)
  }
}
