/**
 * Client view of the optional Host `stage` projection, plus the display slice
 * of the optional `contextPressure` projection.
 *
 * The wire value is the Host's authoritative catalog/history/metrics: it is
 * present when the runtime mounted stage-switch (and the host release renders
 * the wire view); {@link useStageWire} additionally requires the session's own
 * durable stage record, because the projection key is runtime-global. The
 * type is imported type-only
 * from the workspace source, the same pinning pattern the fold contract uses;
 * the type-only import is erased from the browser bundle, so the tab still
 * runs without stage-switch. The `contextPressure` key has no local type
 * augmentation: token-meter owns that declaration, and the tab only consumes
 * its optional display fields when the capability is present.
 */
import type { StageWireView } from '@ai4rpg/dsh-stage-switch/src/index.ts'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'

export type { StageHistoryEntry, StageWireView } from '@ai4rpg/dsh-stage-switch/src/index.ts'

/** The display fields of the token-meter context-pressure projection. */
export interface ContextPressureView {
  /** Prompt-side pressure of the newest request, when reported. */
  readonly pressureTokens?: number
  /** Projected next-request pressure (sample plus surface movement), when reported. */
  readonly projectedTokens?: number
  /** Newest known route capacity, when reported. */
  readonly contextWindow?: number
}

/**
 * Read the host stage wire value **for a session the plugin actually serves**.
 *
 * The `stage` projection is registered on the runtime-global
 * `sessionProjections` registry, so in a deployment where ANY mounted agent
 * preset includes stage-switch every session's snapshot carries the key —
 * including sessions whose own preset never mounted the plugin. The wire view
 * alone therefore says "some preset mounted stage-switch", not "this session
 * runs it".
 *
 * The durable stage record is the per-session activation evidence: the plugin
 * appends one at the first accepted step (the initial stage prompt) and on
 * every switch, and a session can only change presets while blank, so a
 * session with no record has never run under stage-switch. Gating on the
 * record keeps the tab, title, and pill honest for other presets' sessions;
 * before the first accepted step the surfaces degrade exactly like a
 * composition without the plugin (empty tab, type-label title, no pill).
 *
 * The raw value stays available through `useProjection('stage')` for a caller
 * that knowingly wants the catalog before the first record.
 * @param useProjection - the Session slot's projection reader.
 * @returns the wire view of an activated session, or undefined.
 */
export function useStageWire(useProjection: UseProjection): StageWireView | undefined {
  const wire = useProjection('stage')
  if (wire === undefined || wire.history.length === 0) return undefined
  return wire
}

/**
 * Read the optional context-pressure value without extending the global
 * projection map (token-meter owns that key's declaration).
 * @param useProjection - the Session slot's projection reader.
 * @returns the display slice, or undefined when token-meter is absent.
 */
export function useContextPressure(useProjection: UseProjection): ContextPressureView | undefined {
  return useProjection('contextPressure' as never) as ContextPressureView | undefined
}
