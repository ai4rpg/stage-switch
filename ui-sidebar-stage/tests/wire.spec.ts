/**
 * The wire read face's activation gate.
 *
 * The `stage` projection is runtime-global (any mounted preset that includes
 * stage-switch registers it for every session), so the hook requires the
 * session's own durable stage record before it serves the value. These cases
 * pin that gate; the surfaces' visible degradation is pinned in the body and
 * ambient specs.
 */
import { describe, expect, it } from 'vitest'
import { STAGE_NAMES } from './helpers.ts'
import { useStageWire } from '../src/client/wire.ts'
import type { StageWireView } from '../src/client/wire.ts'

const CATALOG = [
  { name: STAGE_NAMES.first, instruction: 'first' },
  { name: STAGE_NAMES.second, instruction: 'second' },
]

/** A projection reader that answers only the `stage` key. */
function projectionOf(value: StageWireView | undefined) {
  return (key: string): unknown => key === 'stage' ? value : undefined
}

describe('useStageWire', () => {
  it('serves the wire once the session has a durable stage record', () => {
    const wire: StageWireView = {
      stage: STAGE_NAMES.second,
      stages: CATALOG,
      history: [
        {
          stage: STAGE_NAMES.second,
          seq: 1,
          time: 10,
          switched: false,
          messages: 0,
          tools: 0,
          tokens: 0,
          errors: 0,
        },
      ],
      historyTruncated: false,
    }
    expect(useStageWire(projectionOf(wire) as never)).toBe(wire)
  })

  it('hides a wire without a stage record (another preset, or before the first step)', () => {
    const fresh: StageWireView = {
      stage: STAGE_NAMES.first,
      stages: CATALOG,
      history: [],
      historyTruncated: false,
    }
    expect(useStageWire(projectionOf(fresh) as never)).toBeUndefined()
  })

  it('hides the value when the projection is absent', () => {
    expect(useStageWire(projectionOf(undefined) as never)).toBeUndefined()
  })
})
