/**
 * The presentation merge: the Host wire view is authoritative when present;
 * the fold fallback keeps the visited-only view for sessions without the
 * capability; both normalize to the same segment shape.
 */
import { describe, expect, it } from 'vitest'
import { STAGE_ALIASES, STAGE_NAMES } from './helpers.ts'
import { presentStages, stageLabel } from '../src/client/present.ts'
import type { StageWireView } from '../src/client/wire.ts'
import type { StageRecord } from '../src/client/fold.ts'
import type { StageView } from '../src/client/store.ts'

const CATALOG = [
  { name: STAGE_NAMES.first, instruction: `Do ${STAGE_NAMES.first}.` },
  { name: STAGE_NAMES.second, alias: STAGE_ALIASES.second, instruction: `Do ${STAGE_NAMES.second}.` },
  { name: STAGE_NAMES.third, alias: STAGE_ALIASES.third, instruction: `Do ${STAGE_NAMES.third}.` },
]

function wire(): StageWireView {
  return {
    stage: STAGE_NAMES.second,
    stages: CATALOG,
    history: [
      { stage: STAGE_NAMES.first, seq: 1, time: 10, switched: false, messages: 4, tools: 2, tokens: 80, errors: 0 },
      { stage: STAGE_NAMES.second, seq: 2, time: 20, switched: true, messages: 3, tools: 1, tokens: 120, errors: 1 },
    ],
    historyTruncated: true,
  }
}

function record(stage: string, seq: number, switched: boolean, time: number): StageRecord {
  return {
    stage,
    seq,
    time,
    switched,
    instruction: `Do ${stage}.`,
    messages: seq,
    tools: 0,
    tokens: 0,
    errors: 0,
  }
}

describe('presentStages', () => {
  it('uses the wire catalog, history, counters, and truncation flag', () => {
    const view = presentStages(wire(), { current: undefined, records: [] })
    expect(view.source).toBe('projection')
    expect(view.current).toBe(STAGE_NAMES.second)
    expect(view.currentLabel).toBe(STAGE_ALIASES.second)
    expect(view.segments).toHaveLength(2)
    expect(view.segments[0]).toMatchObject({
      stage: STAGE_NAMES.first,
      label: STAGE_NAMES.first,
      instruction: `Do ${STAGE_NAMES.first}.`,
      messages: 4,
      tools: 2,
      tokens: 80,
      live: false,
    })
    expect(view.segments[1]).toMatchObject({
      stage: STAGE_NAMES.second,
      label: STAGE_ALIASES.second,
      instruction: `Do ${STAGE_NAMES.second}.`,
      errors: 1,
      live: true,
    })
    expect(view.future.map(entry => entry.name)).toEqual([STAGE_NAMES.third])
    expect(view.future[0]?.alias).toBe(STAGE_ALIASES.third)
    expect(view.historyTruncated).toBe(true)
  })

  it('keeps a current initial stage before the first record, with no timer', () => {
    const view = presentStages({
      stage: STAGE_NAMES.second,
      stages: CATALOG,
      history: [],
      historyTruncated: false,
    }, { current: undefined, records: [] })
    expect(view.current).toBe(STAGE_NAMES.second)
    expect(view.currentLabel).toBe(STAGE_ALIASES.second)
    expect(view.segments).toHaveLength(1)
    expect(view.segments[0]).toMatchObject({
      stage: STAGE_NAMES.second,
      label: STAGE_ALIASES.second,
      seq: -1,
      time: undefined,
      live: true,
    })
    expect(view.future.map(entry => entry.name)).toEqual([STAGE_NAMES.third])
  })

  it('falls back to the fold with visited stages only and no future nodes', () => {
    const folded: StageView = {
      current: STAGE_NAMES.second,
      records: [
        record(STAGE_NAMES.first, 1, false, 10),
        record(STAGE_NAMES.second, 2, true, 20),
      ],
    }
    const view = presentStages(undefined, folded)
    expect(view.source).toBe('fold')
    expect(view.current).toBe(STAGE_NAMES.second)
    // No catalog channel in the fallback: labels are the durable names.
    expect(view.currentLabel).toBe(STAGE_NAMES.second)
    expect(view.catalog.map(entry => entry.name)).toEqual([STAGE_NAMES.first, STAGE_NAMES.second])
    expect(view.catalog.every(entry => entry.alias === undefined)).toBe(true)
    expect(view.segments).toHaveLength(2)
    expect(view.segments[1]).toMatchObject({
      stage: STAGE_NAMES.second,
      label: STAGE_NAMES.second,
      live: true,
      switched: true,
    })
    expect(view.future).toEqual([])
    expect(view.historyTruncated).toBe(false)
  })

  it('labels a stage with its alias when configured and its name otherwise', () => {
    expect(stageLabel({ name: STAGE_NAMES.first })).toBe(STAGE_NAMES.first)
    expect(stageLabel({ name: STAGE_NAMES.second, alias: STAGE_ALIASES.second }))
      .toBe(STAGE_ALIASES.second)
  })
})
