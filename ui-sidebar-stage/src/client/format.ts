/**
 * Presentation-only formatting for the stage tab: durations, clock times,
 * compact token counts, and the stable per-stage identity colour.
 */

/** Stage identity accents, in catalog order; the last one is a deliberate identity hue. */
const STAGE_ACCENTS = [
  'var(--dsw-static-amber-500)',
  'var(--dsw-static-green-500)',
  'var(--dsw-alias-state-business-primary)',
  'rgb(155 123 240)',
] as const

/** The clock formatter is locale-aware but stable for the tab's lifetime. */
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/**
 * Format an elapsed span for the hero and the journey.
 * @param milliseconds - non-negative elapsed time.
 * @returns compact text such as `42s`, `12m 41s`, `1h 04m`.
 */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (seconds < 60) return `${String(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    const rest = seconds % 60
    return rest === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(rest).padStart(2, '0')}s`
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${String(hours)}h ${String(rest).padStart(2, '0')}m`
}

/**
 * Format a record's wall-clock time in the browser's locale.
 * @param epochMs - Unix epoch milliseconds.
 * @returns the local hour and minute.
 */
export function formatClock(epochMs: number): string {
  return CLOCK.format(new Date(epochMs))
}

/**
 * Format a token count compactly (`999`, `12.4k`, `1.2m`).
 * @param tokens - non-negative token count.
 * @returns compact text.
 */
export function formatTokens(tokens: number): string {
  const value = Math.max(0, Math.round(tokens))
  if (value < 1_000) return String(value)
  if (value < 1_000_000) {
    const thousands = value / 1_000
    const text = Number.isInteger(thousands) ? String(thousands) : thousands.toFixed(1)
    return `${thousands < 100 ? text : String(Math.round(thousands))}k`
  }
  const millions = value / 1_000_000
  const text = Number.isInteger(millions) ? String(millions) : millions.toFixed(1)
  return `${millions < 100 ? text : String(Math.round(millions))}m`
}

/** A stable hash for stage names outside the configured catalog. */
function hashOf(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash
}

/**
 * The identity colour for one stage. The configured catalog order is the
 * stable source (the same stage keeps its colour across visits); unknown
 * names fall back to a name hash.
 * @param name - stage name.
 * @param catalog - the ordered catalog, when known.
 * @returns a CSS colour expression.
 */
export function stageAccent(name: string, catalog: readonly { readonly name: string }[]): string {
  const index = catalog.findIndex(stage => stage.name === name)
  return STAGE_ACCENTS[(index >= 0 ? index : hashOf(name)) % STAGE_ACCENTS.length] ?? STAGE_ACCENTS[0]
}

/**
 * Clamp a pressure ratio to a display percentage.
 * @param used - reported or projected prompt tokens.
 * @param window - route capacity.
 * @returns an integer 0–100, or undefined without both values.
 */
export function contextPercent(used: number | undefined, window: number | undefined): number | undefined {
  if (used === undefined || window === undefined || window <= 0) return undefined
  return Math.min(100, Math.max(0, Math.round(used / window * 100)))
}

/** Whether the platform's primary shortcut modifier is Command. */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad/.test(navigator.platform)
}
