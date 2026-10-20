/**
 * One stage-tab presentation, built from either the Host `stage` wire view
 * (the preferred source: complete catalog, history, and counters) or the
 * client fold fallback (visited stages only, with the same counters parsed
 * from the loaded window).
 *
 * Normalizing both sources into {@link StageSegment}s keeps the rendering
 * code free of source branches: the hero, journey, metrics, and palette read
 * the same shapes whether the composition mounted stage-switch or not.
 */
import type { StageWireView } from './wire.ts'
import type { StageRecord } from './fold.ts'
import type { StageView } from './store.ts'

/** One catalog entry with its deployment copy. */
export interface StageCatalogEntry {
  readonly name: string
  /** Optional display alias from the deployment config; shown instead of the name. */
  readonly alias?: string
  readonly instruction: string
}

/** The label a UI surface shows for a catalog stage: its alias when configured. */
export function stageLabel(stage: { readonly name: string, readonly alias?: string }): string {
  return stage.alias ?? stage.name
}

/** One recorded stage visit, normalized for rendering. */
export interface StageSegment {
  /** The stage this visit records (the durable name). */
  readonly stage: string
  /** The label to display for this visit: the catalog alias when configured. */
  readonly label: string
  /** Session sequence of the record; `-1` for a not-yet-recorded initial stage. */
  readonly seq: number
  /** Unix epoch milliseconds of the record; undefined before the first record. */
  readonly time: number | undefined
  /** Whether the visit was a transition (`Stage switched to`) rather than a session-start entry. */
  readonly switched: boolean
  /** The stage instruction from the catalog or the prompt body. */
  readonly instruction: string | undefined
  /** Non-stage user messages plus assistant messages during this visit. */
  readonly messages: number
  /** `tool/call` events during this visit. */
  readonly tools: number
  /** Provider-reported tokens during this visit. */
  readonly tokens: number
  /** Failed `tool/result` events during this visit. */
  readonly errors: number
  /** Whether this is the current visit (the live row). */
  readonly live: boolean
}

/** What the tab renders. */
export interface StagePresentation {
  /** The stage in force (durable name), or undefined when the session has no stage view at all. */
  readonly current: string | undefined
  /** The label to display for the current stage: its catalog alias when configured. */
  readonly currentLabel: string | undefined
  /** The ordered catalog available to the palette and the journey's future nodes. */
  readonly catalog: readonly StageCatalogEntry[]
  /** Recorded visits in log order, ending with the current visit when known. */
  readonly segments: readonly StageSegment[]
  /** Catalog stages not yet recorded, in catalog order; empty in the fold fallback. */
  readonly future: readonly StageCatalogEntry[]
  /** Whether the Host bounded the visible history. */
  readonly historyTruncated: boolean
  /** Which source produced this presentation. */
  readonly source: 'projection' | 'fold'
}

/** Map a wire history entry to a segment, applying the catalog instruction. */
function segmentOf(
  entry: StageWireView['history'][number],
  catalog: readonly StageCatalogEntry[],
  live: boolean,
): StageSegment {
  return {
    stage: entry.stage,
    label: catalog.find(stage => stage.name === entry.stage)?.alias ?? entry.stage,
    seq: entry.seq,
    time: entry.time,
    switched: entry.switched,
    instruction: catalog.find(stage => stage.name === entry.stage)?.instruction,
    messages: entry.messages,
    tools: entry.tools,
    tokens: entry.tokens,
    errors: entry.errors,
    live,
  }
}

/** Map one fold record to a segment. */
function segmentOfRecord(record: StageRecord, live: boolean): StageSegment {
  return {
    stage: record.stage,
    label: record.stage,
    seq: record.seq,
    time: record.time,
    switched: record.switched,
    instruction: record.instruction,
    messages: record.messages,
    tools: record.tools,
    tokens: record.tokens,
    errors: record.errors,
    live,
  }
}

/** The distinct stages a fold saw, in first-record order. */
function foldCatalog(records: readonly StageRecord[]): StageCatalogEntry[] {
  const seen = new Set<string>()
  const catalog: StageCatalogEntry[] = []
  for (const record of records) {
    if (seen.has(record.stage)) continue
    seen.add(record.stage)
    catalog.push({ name: record.stage, instruction: record.instruction ?? '' })
  }
  return catalog
}

/**
 * Build the tab presentation.
 * @param wire - the Host projection value, when the capability is present.
 * @param folded - the client event-window fold (always available).
 * @returns the normalized presentation.
 */
export function presentStages(wire: StageWireView | undefined, folded: StageView): StagePresentation {
  if (wire !== undefined) {
    const catalog: StageCatalogEntry[] = wire.stages.map(({ name, alias, instruction }) =>
      alias === undefined ? { name, instruction } : { name, alias, instruction })
    if (wire.history.length > 0) {
      const segments = wire.history.map((entry, index) =>
        segmentOf(entry, catalog, index === wire.history.length - 1))
      const visited = new Set(wire.history.map(entry => entry.stage))
      const future = catalog.filter(stage => !visited.has(stage.name))
      return {
        current: wire.stage,
        currentLabel: catalog.find(stage => stage.name === wire.stage)?.alias ?? wire.stage,
        catalog,
        segments,
        future,
        historyTruncated: wire.historyTruncated,
        source: 'projection',
      }
    }
    // A fresh session has a current stage (the configured initial) before the
    // first durable record. Keep the hero and the journey's start node, but
    // mark the entry time absent so the timer says "waiting for the first turn".
    const current = catalog.find(stage => stage.name === wire.stage)
    const currentIndex = catalog.findIndex(stage => stage.name === wire.stage)
    const segments: StageSegment[] = current === undefined
      ? []
      : [{
        stage: current.name,
        label: current.alias ?? current.name,
        seq: -1,
        time: undefined,
        switched: false,
        instruction: current.instruction,
        messages: 0,
        tools: 0,
        tokens: 0,
        errors: 0,
        live: true,
      }]
    const future = currentIndex < 0
      ? catalog
      : catalog.slice(currentIndex + 1)
    return {
      current: wire.stage,
      currentLabel: current === undefined ? wire.stage : current.alias ?? current.name,
      catalog,
      segments,
      future,
      historyTruncated: wire.historyTruncated,
      source: 'projection',
    }
  }

  const records = folded.records
  const segments = records.map((record, index) => segmentOfRecord(record, index === records.length - 1))
  return {
    current: folded.current,
    // The fold has no catalog channel, so its labels are the durable names.
    currentLabel: folded.current,
    catalog: foldCatalog(records),
    segments,
    future: [],
    historyTruncated: false,
    source: 'fold',
  }
}
