/** Test helper: the locale service's bind contract as a plain dictionary read. */
export function makeTranslate<T extends Record<string, string>>(dict: T): (key: string) => string {
  return key => {
    const value = dict[key as keyof T]
    if (value === undefined) throw new Error(`missing dictionary key: ${key}`)
    return value
  }
}

/**
 * Stage names shared by the store/body/switch/apply/integration fixtures.
 * Arbitrary values that only need to satisfy the fold's summary grammar
 * (`[a-z][a-z0-9_-]*`): they are test data, never production config — the
 * production fold reads stage names from durable records, and `src/` hardcodes
 * none. Centralised so the specs cannot drift apart, mirroring the stage-switch
 * package's own TEST_STAGES convention. `tests/fold.spec.ts` deliberately keeps
 * literal summary strings instead: it pins the fold CONTRACT's exact shapes,
 * where a literal is the point.
 */
export const STAGE_NAMES = {
  /** The first-recorded stage (an `entered` row). */
  first: 'stage-a',
  /** The stage switched to (a `switched` row, the live record). */
  second: 'stage-b',
  /** A third stage for live-update fixtures. */
  third: 'stage-c',
  /** The switch action's picked target (any grammar-valid name). */
  target: 'stage-d',
} as const
