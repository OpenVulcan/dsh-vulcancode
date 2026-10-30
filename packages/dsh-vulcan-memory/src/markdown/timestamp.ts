/** Minute-precision UTC timestamps written into node metadata (`timestamp.rs`). */

/** `YYYY-MM-DDTHH:MMZ` for an instant. */
export function formatUtcMinute(instant: Date): string {
  return `${instant.toISOString().slice(0, 16)}Z`
}

export function nowUtcMinute(): string {
  return formatUtcMinute(new Date())
}

/** Whether text has the exact `YYYY-MM-DDTHH:MMZ` shape. */
export function isUtcMinute(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(text)
}
