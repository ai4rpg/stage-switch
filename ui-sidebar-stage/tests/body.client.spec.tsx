// @vitest-environment jsdom
/**
 * The Atlas stage tab: the preferred Host projection wire view, the fold
 * fallback for sessions without the capability, the journey rows, the
 * command palette, and the honest pending/failure states.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate, STAGE_ALIASES, STAGE_NAMES } from './helpers.ts'
import { StageBody } from '../src/client/StageBody.tsx'
import type { StageView } from '../src/client/store.ts'
import type { StageRecord } from '../src/client/fold.ts'
import type { StageWireView } from '../src/client/wire.ts'
import type { StageSwitchOutcome } from '../src/client/switch.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)
const NOW = 1_700_000_000_000

afterEach(cleanup)

/** One fold record with the Atlas metrics. */
function record(
  stage: string,
  seq: number,
  switched: boolean,
  time = NOW - 60_000,
  metrics: Partial<Pick<StageRecord, 'messages' | 'tools' | 'tokens' | 'errors' | 'instruction'>> = {},
): StageRecord {
  return {
    stage,
    seq,
    time,
    switched,
    instruction: metrics.instruction ?? `Do ${stage}.`,
    messages: metrics.messages ?? 0,
    tools: metrics.tools ?? 0,
    tokens: metrics.tokens ?? 0,
    errors: metrics.errors ?? 0,
  }
}

/** The configured catalog used by the wire fixtures; two stages carry an alias. */
const CATALOG = [
  { name: STAGE_NAMES.first, instruction: `Do ${STAGE_NAMES.first}.` },
  { name: STAGE_NAMES.second, alias: STAGE_ALIASES.second, instruction: `Do ${STAGE_NAMES.second}.` },
  { name: STAGE_NAMES.third, alias: STAGE_ALIASES.third, instruction: `Do ${STAGE_NAMES.third}.` },
  { name: STAGE_NAMES.target, instruction: `Do ${STAGE_NAMES.target}.` },
]

/** A wire view with the current stage second and two future stages. */
function wireView(): StageWireView {
  return {
    stage: STAGE_NAMES.second,
    stages: CATALOG,
    history: [
      { stage: STAGE_NAMES.first, seq: 1, time: NOW - 900_000, switched: false, messages: 4, tools: 2, tokens: 800, errors: 0 },
      { stage: STAGE_NAMES.second, seq: 2, time: NOW - 60_000, switched: true, messages: 3, tools: 2, tokens: 1_200, errors: 0 },
    ],
    historyTruncated: false,
  }
}

/** The fold fallback view: only visited stages, no catalog. */
function foldView(): StageView {
  return {
    current: STAGE_NAMES.second,
    records: [
      record(STAGE_NAMES.first, 1, false, NOW - 900_000, { messages: 4, tools: 2 }),
      record(STAGE_NAMES.second, 2, true, NOW - 60_000, { messages: 3, tools: 2 }),
    ],
  }
}

interface BodyOptions {
  readonly view?: StageView
  readonly wire?: StageWireView
  readonly running?: boolean
  readonly hasMore?: boolean
  readonly switchStage?: (stage: string) => Promise<StageSwitchOutcome>
}

/** Render the body with mocked slot hooks. */
function bodyOf(options: BodyOptions = {}) {
  const view = options.view ?? { current: undefined, records: [] }
  const wire = options.wire
  const useStage = <T,>(selector: (state: StageView) => T): T => selector(view)
  const useProjection = (key: string): unknown => key === 'stage' ? wire : undefined
  const useSession = <T,>(selector: (state: { running: boolean, hasMore: boolean }) => T): T =>
    selector({ running: options.running ?? true, hasMore: options.hasMore ?? false })
  return render(createElement(StageBody, {
    useStage,
    useProjection,
    useSession,
    switchStage: options.switchStage ?? (() => Promise.resolve({ ok: true } as StageSwitchOutcome)),
    t,
  } as never))
}

/** Open the palette through the switch button. */
async function openPalette(container: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(container.querySelector('[data-stage-switch]')!)
  })
}

describe('StageBody', () => {
  it('renders the empty state and lets a typed stage name start from nothing', async () => {
    const switchStage = vi.fn(() => Promise.resolve({ ok: true } as StageSwitchOutcome))
    const { container } = bodyOf({ switchStage })
    expect(container.querySelector('[data-stage-empty]')?.textContent).toContain(zh.emptyTitle)
    expect(container.querySelector('[data-stage-current]')).toBeNull()

    await act(async () => {
      fireEvent.click(container.querySelector('.ui-stage-empty-action')!)
    })
    const input = container.querySelector<HTMLInputElement>('.ui-stage-search-input')!
    await act(async () => {
      fireEvent.change(input, { target: { value: STAGE_NAMES.target } })
    })
    const custom = container.querySelector(`[data-stage-option="${STAGE_NAMES.target}"]`)
    expect(custom?.textContent).toContain(zh.custom)
    await act(async () => {
      fireEvent.click(custom!)
    })
    expect(switchStage).toHaveBeenCalledWith(STAGE_NAMES.target)
    expect(container.querySelector('[data-stage-menu]')).toBeNull()
  })

  it('treats a wire without a durable stage record as absent', () => {
    // The projection key is runtime-global: another preset's session (or this
    // session before its first accepted step) carries a wire with no record.
    const fresh: StageWireView = {
      stage: STAGE_NAMES.first,
      stages: CATALOG,
      history: [],
      historyTruncated: false,
    }
    const { container } = bodyOf({ wire: fresh })
    expect(container.querySelector('[data-stage-empty]')).not.toBeNull()
    expect(container.querySelector('[data-stage-current]')).toBeNull()
  })

  it('renders the Host wire view: hero, live metrics, visited journey, and future nodes', () => {
    const { container } = bodyOf({ wire: wireView() })
    const hero = container.querySelector<HTMLElement>('[data-stage-current]')
    // The hero shows the display alias; the durable name stays on the node
    // (and in the tooltip) because it is the switch target and log identity.
    expect(hero?.textContent).toBe(STAGE_ALIASES.second)
    expect(hero?.getAttribute('data-stage-name')).toBe(STAGE_NAMES.second)
    expect(hero?.getAttribute('title')).toBe(STAGE_NAMES.second)
    expect(container.querySelector('.ui-stage-brief')?.textContent).toBe(`Do ${STAGE_NAMES.second}.`)
    expect(container.querySelector('.ui-stage-live')?.textContent).toContain(zh.live)
    expect(container.querySelector('.ui-stage-ring-index')?.textContent).toBe('02')
    expect(container.querySelector('.ui-stage-ring-total')?.textContent).toBe('/ 04')

    const values = [...container.querySelectorAll('.ui-stage-metric-value')].map(node => node.textContent)
    expect(values).toEqual(['3', '2', '1.2k'])

    const rows = [...container.querySelectorAll('[data-stage-history] li')]
    expect(rows).toHaveLength(4)
    expect(rows[0]?.textContent).toContain(STAGE_NAMES.first)
    expect(rows[1]?.textContent).toContain(STAGE_ALIASES.second)
    expect(rows[1]?.textContent).not.toContain(STAGE_NAMES.second)
    expect(rows[1]?.textContent).toContain(zh.now)
    expect(rows[1]?.getAttribute('aria-current')).toBe('step')
    expect(rows[2]?.textContent).toContain(STAGE_ALIASES.third)
    expect(rows[2]?.textContent).toContain(zh.notVisited)
    expect(rows[3]?.textContent).toContain(zh.notVisited)
    expect(container.querySelector('.ui-stage-section-count')?.textContent).toBe('2 / 4')
  })

  it('falls back to the client fold: visited only, with the partial-history note', () => {
    const { container } = bodyOf({ view: foldView(), hasMore: true })
    expect(container.querySelector('[data-stage-current]')?.textContent).toBe(STAGE_NAMES.second)
    const rows = [...container.querySelectorAll('[data-stage-history] li')]
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain(STAGE_NAMES.first)
    expect(rows[1]?.textContent).toContain(STAGE_NAMES.second)
    expect(container.querySelector('.ui-stage-section-count')?.textContent)
      .toBe(t('visitedCount', { count: 2 }))
    expect(container.querySelector('.ui-stage-note')?.textContent).toBe(zh.historyPartial)
  })

  it('opens the palette with the full route, marks the current stage, and switches a pick', async () => {
    const switchStage = vi.fn(() => Promise.resolve({ ok: true } as StageSwitchOutcome))
    const { container } = bodyOf({ wire: wireView(), switchStage })
    await openPalette(container)
    const options = [...container.querySelectorAll<HTMLButtonElement>('[data-stage-option]')]
    expect(options.map(option => option.getAttribute('data-stage-option')))
      .toEqual([STAGE_NAMES.first, STAGE_NAMES.second, STAGE_NAMES.third, STAGE_NAMES.target])
    // Aliased rows show the label plus the durable name as a hint; the data
    // attribute (the switch target) stays the name.
    expect(options[1]?.textContent).toContain(STAGE_ALIASES.second)
    expect(options[1]?.querySelector('.ui-stage-option-hint')?.textContent).toBe(STAGE_NAMES.second)
    expect(options[1]?.textContent).toContain(zh.now)
    expect(options[2]?.textContent).toContain(STAGE_ALIASES.third)
    expect(options[2]?.querySelector('.ui-stage-option-hint')?.textContent).toBe(STAGE_NAMES.third)
    expect(options[2]?.textContent).toContain(zh.notVisited)
    // The current stage is inert; another row submits the command.
    await act(async () => {
      fireEvent.click(options[1]!)
    })
    expect(switchStage).not.toHaveBeenCalled()
    await openPalette(container)
    await act(async () => {
      fireEvent.click(container.querySelector(`[data-stage-option="${STAGE_NAMES.third}"]`)!)
    })
    expect(switchStage).toHaveBeenCalledWith(STAGE_NAMES.third)
    expect(container.querySelector('[data-stage-menu]')).toBeNull()
  })

  it('filters the palette by display alias and still submits the durable name', async () => {
    const switchStage = vi.fn(() => Promise.resolve({ ok: true } as StageSwitchOutcome))
    const { container } = bodyOf({ wire: wireView(), switchStage })
    await openPalette(container)
    const input = container.querySelector<HTMLInputElement>('.ui-stage-search-input')!
    await act(async () => {
      fireEvent.change(input, { target: { value: STAGE_ALIASES.third } })
    })
    const options = [...container.querySelectorAll<HTMLButtonElement>('[data-stage-option]')]
    expect(options.map(option => option.getAttribute('data-stage-option'))).toEqual([STAGE_NAMES.third])
    await act(async () => {
      fireEvent.click(options[0]!)
    })
    expect(switchStage).toHaveBeenCalledWith(STAGE_NAMES.third)
  })

  it('switches directly from a journey row and shows the requested note while the record is queued', async () => {
    let resolve: (outcome: StageSwitchOutcome) => void = () => {}
    const switchStage = vi.fn(() => new Promise<StageSwitchOutcome>((done) => { resolve = done }))
    const { container } = bodyOf({ wire: wireView(), switchStage })
    const past = container.querySelector<HTMLButtonElement>(`[data-stage-history] button[aria-label="${zh.switchTo} ${STAGE_NAMES.first}"]`)!
    await act(async () => {
      fireEvent.click(past)
    })
    expect(switchStage).toHaveBeenCalledWith(STAGE_NAMES.first)
    expect(container.querySelector<HTMLButtonElement>('[data-stage-switch]')?.disabled).toBe(true)
    await act(async () => {
      resolve({ ok: true })
    })
    expect(container.querySelector('.ui-stage-requested')?.textContent)
      .toBe(t('requested', { stage: STAGE_NAMES.first }))
    expect(container.querySelector<HTMLButtonElement>('[data-stage-switch]')?.disabled).toBe(false)
  })

  it('names a queued switch by its display alias', async () => {
    let resolve: (outcome: StageSwitchOutcome) => void = () => {}
    const switchStage = vi.fn(() => new Promise<StageSwitchOutcome>((done) => { resolve = done }))
    const { container } = bodyOf({ wire: wireView(), switchStage })
    const future = container.querySelector<HTMLButtonElement>(
      `[data-stage-history] button[aria-label="${zh.switchTo} ${STAGE_ALIASES.third}"]`,
    )!
    await act(async () => {
      fireEvent.click(future)
    })
    expect(switchStage).toHaveBeenCalledWith(STAGE_NAMES.third)
    await act(async () => {
      resolve({ ok: true })
    })
    expect(container.querySelector('.ui-stage-requested')?.textContent)
      .toBe(t('requested', { stage: STAGE_ALIASES.third }))
  })

  it('shows a failed switch with the command message and clears the pending lock', async () => {
    const switchStage = vi.fn(() => Promise.resolve({
      ok: false,
      reason: 'failed',
      message: 'unknown stage',
    } as StageSwitchOutcome))
    const { container } = bodyOf({ wire: wireView(), switchStage })
    const past = container.querySelector<HTMLButtonElement>(`[data-stage-history] button[aria-label="${zh.switchTo} ${STAGE_NAMES.first}"]`)!
    await act(async () => {
      fireEvent.click(past)
    })
    expect(container.querySelector('[data-stage-failure]')?.textContent)
      .toContain('unknown stage')
    expect(container.querySelector<HTMLButtonElement>('[data-stage-switch]')?.disabled).toBe(false)
  })

  it('opens with Ctrl/Cmd+K and closes on Escape', async () => {
    const { container } = bodyOf({ wire: wireView() })
    const root = container.querySelector('[data-stage-tab]')!
    await act(async () => {
      fireEvent.keyDown(root, { key: 'k', ctrlKey: true })
    })
    expect(container.querySelector('[data-stage-menu]')).not.toBeNull()
    await act(async () => {
      fireEvent.keyDown(container.querySelector('.ui-stage-palette')!, { key: 'Escape' })
    })
    expect(container.querySelector('[data-stage-menu]')).toBeNull()
  })
})
