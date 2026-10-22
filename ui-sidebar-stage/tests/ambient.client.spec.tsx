// @vitest-environment jsdom
/**
 * The ambient surfaces: the tab chip's live stage title and the composer's
 * stage pill. Both read the Host wire view and degrade (label / absent) when
 * the capability is missing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate, STAGE_ALIASES, STAGE_NAMES } from './helpers.ts'
import { StageTitle } from '../src/client/StageTitle.tsx'
import { StageDock } from '../src/client/StageDock.tsx'
import type { StageWireView } from '../src/client/wire.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)
const now = Date.now()
const wire: StageWireView = {
  stage: STAGE_NAMES.second,
  stages: [
    { name: STAGE_NAMES.first, instruction: 'first' },
    { name: STAGE_NAMES.second, alias: STAGE_ALIASES.second, instruction: 'second' },
  ],
  history: [
    { stage: STAGE_NAMES.first, seq: 1, time: now - 120_000, switched: false, messages: 1, tools: 0, tokens: 0, errors: 0 },
    { stage: STAGE_NAMES.second, seq: 2, time: now - 60_000, switched: true, messages: 2, tools: 1, tokens: 10, errors: 0 },
  ],
  historyTruncated: false,
}

/** A wire view with no durable stage record: another preset's session, or a fresh one. */
const freshWire: StageWireView = {
  stage: STAGE_NAMES.first,
  stages: wire.stages,
  history: [],
  historyTruncated: false,
}

afterEach(cleanup)

function projectionOf(value: StageWireView | undefined) {
  return (key: string): unknown => key === 'stage' ? value : undefined
}

describe('StageTitle', () => {
  it('shows the current stage label and its identity dot from the wire view', () => {
    const { container } = render(createElement(StageTitle, {
      useProjection: projectionOf(wire),
      t,
    } as never))
    // The chip shows the display alias; the tooltip keeps the durable name.
    expect(container.textContent).toBe(STAGE_ALIASES.second)
    expect(container.querySelector<HTMLElement>('.ui-stage-title-dot')?.style.background).not.toBe('')
    expect(container.firstElementChild?.getAttribute('title')).toBe(`${zh['type.label']}: ${STAGE_NAMES.second}`)
  })

  it('falls back to the tab type label without the wire view', () => {
    const { container } = render(createElement(StageTitle, {
      useProjection: projectionOf(undefined),
      t,
    } as never))
    expect(container.textContent).toBe(zh['type.label'])
  })

  it('falls back to the type label for a wire without a durable stage record', () => {
    const { container } = render(createElement(StageTitle, {
      useProjection: projectionOf(freshWire),
      t,
    } as never))
    expect(container.textContent).toBe(zh['type.label'])
  })
})

describe('StageDock', () => {
  it('renders the stage pill and opens the stage tab on click', () => {
    const openStage = vi.fn()
    const useSession = <T,>(selector: (state: { running: boolean }) => T): T => selector({ running: true })
    const { container } = render(createElement(StageDock, {
      useProjection: projectionOf(wire),
      useSession,
      openStage,
      t,
    } as never))
    const pill = container.querySelector<HTMLButtonElement>('[data-stage-dock]')
    expect(pill).not.toBeNull()
    expect(pill?.textContent).toContain(STAGE_ALIASES.second)
    expect(pill?.textContent).not.toContain(STAGE_NAMES.second)
    expect(pill?.getAttribute('aria-label')).toBe(`${zh.openStage}: ${STAGE_ALIASES.second}`)
    expect(container.querySelector('.ui-stage-dock-meta')?.textContent).toMatch(/\d/)
    fireEvent.click(pill!)
    expect(openStage).toHaveBeenCalledTimes(1)
  })

  it('renders nothing without the wire view', () => {
    const useSession = <T,>(selector: (state: { running: boolean }) => T): T => selector({ running: false })
    const { container } = render(createElement(StageDock, {
      useProjection: projectionOf(undefined),
      useSession,
      openStage: vi.fn(),
      t,
    } as never))
    expect(container.querySelector('[data-stage-dock]')).toBeNull()
  })

  it('renders nothing for a wire without a durable stage record', () => {
    const useSession = <T,>(selector: (state: { running: boolean }) => T): T => selector({ running: false })
    const { container } = render(createElement(StageDock, {
      useProjection: projectionOf(freshWire),
      useSession,
      openStage: vi.fn(),
      t,
    } as never))
    expect(container.querySelector('[data-stage-dock]')).toBeNull()
  })

  it('counts active turn time and freezes the pill while the session is idle', () => {
    vi.useFakeTimers()
    const START = 1_700_000_000_000
    vi.setSystemTime(START)
    try {
      const live = {
        stage: STAGE_NAMES.second,
        seq: 2,
        time: START - 60_000,
        switched: true,
        messages: 2,
        tools: 1,
        tokens: 10,
        errors: 0,
      }
      const state: { wire: StageWireView, running: boolean } = {
        wire: {
          stage: STAGE_NAMES.second,
          stages: wire.stages,
          history: [{ ...live, time: START - 600_000, activeMs: 10_000 }, { ...live, activeMs: 60_000 }],
          historyTruncated: false,
          activeTurn: { since: START, through: START },
        },
        running: true,
      }
      const useProjection = (key: string): unknown => key === 'stage' ? state.wire : undefined
      const useSession = <T,>(selector: (view: { running: boolean }) => T): T =>
        selector({ running: state.running })
      const element = () => createElement(StageDock, {
        useProjection,
        useSession,
        openStage: vi.fn(),
        t,
      } as never)
      const { container, rerender } = render(element())
      const meta = (): string => container.querySelector('.ui-stage-dock-meta')?.textContent ?? ''

      expect(meta()).toBe('1m')
      act(() => { vi.advanceTimersByTime(5_000) })
      expect(meta()).toBe('1m 05s')

      state.wire = {
        ...state.wire,
        history: [state.wire.history[0]!, { ...live, activeMs: 65_000 }],
        activeTurn: undefined,
      }
      state.running = false
      rerender(element())
      act(() => { vi.advanceTimersByTime(30_000) })
      expect(meta()).toBe('1m 05s')
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })
})
