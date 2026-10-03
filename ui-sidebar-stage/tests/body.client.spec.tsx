// @vitest-environment jsdom
/**
 * The body: the current stage as a switch dropdown over the recorded stages,
 * the transition history in log order, and the empty state before the first
 * record.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate, STAGE_NAMES } from './helpers.ts'
import { StageBody } from '../src/client/StageBody.tsx'
import type { StageView } from '../src/client/store.ts'
import type { StageSwitchOutcome } from '../src/client/switch.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

function bodyOf(view: StageView, switchStage: (stage: string) => Promise<StageSwitchOutcome> = () => Promise.resolve({ ok: true })) {
  const useStage = <T,>(selector: (state: StageView) => T): T => selector(view)
  return render(createElement(StageBody, { useStage, switchStage, t } as never))
}

/** The option rows of the open dropdown, in list order. */
function optionsOf(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('[data-stage-menu] [role="option"]')]
}

describe('StageBody', () => {
  it('renders the empty state before the first record', () => {
    const { container } = bodyOf({ current: undefined, records: [] })
    expect(container.querySelector('[data-stage-empty]')?.textContent).toBe(zh.empty)
    // No records means no stage to show or offer in the dropdown.
    expect(container.querySelector('[data-stage-current]')).toBeNull()
  })

  it('follows the pane\'s official visual language: gutter, capsule, and the live record\'s accent', () => {
    // The pane's scroller insets nothing (verified against the live pane
    // chain), so the body insets itself. The current stage rides the guide
    // tab's capsule shape on alias tokens (theme-aware without an override),
    // and the history's live record is the only row on the business accent.
    const empty = render(createElement(StageBody, {
      useStage: <T, >(selector: (state: StageView) => T): T => selector({ current: undefined, records: [] }),
      switchStage: () => Promise.resolve({ ok: true }),
      t,
    } as never)).container
    expect(empty.querySelector<HTMLElement>('[data-stage-empty]')?.style.margin).toBe('0px')

    const { container } = bodyOf({
      current: STAGE_NAMES.second,
      records: [
        { stage: STAGE_NAMES.first, seq: 1, time: 0, switched: false },
        { stage: STAGE_NAMES.second, seq: 2, time: 0, switched: true },
      ],
    })
    const section = container.querySelector<HTMLElement>('[data-stage-tab]')
    // jsdom normalizes the shorthand to its four-value form.
    expect(section?.style.padding).toBe('16px 16px 24px 16px')
    const trigger = container.querySelector<HTMLButtonElement>('[data-stage-current]')
    expect(trigger?.style.background).toBe('var(--dsw-alias-bg-layer-1)')
    expect(trigger?.style.borderRadius).toBe('var(--dsw-radius-xl)')
    expect(trigger?.style.border).toContain('var(--dsw-alias-border-l3)')
    const dots = [...container.querySelectorAll<HTMLSpanElement>('[data-stage-history] li > span[aria-hidden]')]
    expect(dots).toHaveLength(2)
    expect(dots[0]?.style.background).toBe('var(--dsw-alias-border-l3)')
    expect(dots[1]?.style.background).toBe('var(--dsw-alias-state-business-primary)')
  })

  it('renders the current stage on the trigger and the history in log order', () => {
    const { container } = bodyOf({
      current: STAGE_NAMES.second,
      records: [
        { stage: STAGE_NAMES.first, seq: 1, time: 0, switched: false },
        { stage: STAGE_NAMES.second, seq: 2, time: 0, switched: true },
      ],
    })
    // The chevron glyph contributes no text, so the trigger's text is the stage.
    expect(container.querySelector('[data-stage-current]')?.textContent).toBe(STAGE_NAMES.second)
    const items = [...container.querySelectorAll('[data-stage-history] li')].map(item => item.textContent)
    expect(items).toEqual([`${zh.entered} ${STAGE_NAMES.first}`, `${zh.switched} ${STAGE_NAMES.second}`])
  })

  it('opens the dropdown on the trigger and offers the recorded stages, the current selected', async () => {
    const { container } = bodyOf({
      current: STAGE_NAMES.first,
      records: [
        { stage: STAGE_NAMES.first, seq: 1, time: 0, switched: false },
        { stage: STAGE_NAMES.second, seq: 2, time: 0, switched: true },
        { stage: STAGE_NAMES.first, seq: 3, time: 0, switched: true },
      ],
    })
    const trigger = container.querySelector<HTMLButtonElement>('[data-stage-current]')!
    expect(container.querySelector('[data-stage-menu]')).toBeNull()
    await act(async () => {
      fireEvent.click(trigger)
    })
    // The distinct recorded stages in first-record order, the current row
    // marked selected with the trailing check.
    const options = optionsOf(container)
    expect(options.map(option => option.textContent)).toEqual([STAGE_NAMES.first, STAGE_NAMES.second])
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')
    expect(options[0]?.querySelector('svg')).not.toBeNull()
    expect(options[1]?.getAttribute('aria-selected')).toBe('false')
    // The menu card rides the official surface tokens.
    const menu = container.querySelector<HTMLElement>('[data-stage-menu]')!
    expect(menu.style.borderRadius).toBe('var(--dsw-radius-lg)')
    expect(menu.style.background).toBe('var(--dsw-menu-surface-fill)')
  })

  it('closes on Escape, on an outside pointerdown, and on a row pick', async () => {
    const switchStage = vi.fn(() => Promise.resolve({ ok: true } as StageSwitchOutcome))
    const { container } = bodyOf({
      current: STAGE_NAMES.second,
      records: [
        { stage: STAGE_NAMES.first, seq: 1, time: 0, switched: false },
        { stage: STAGE_NAMES.second, seq: 2, time: 0, switched: true },
      ],
    }, switchStage)
    const trigger = container.querySelector<HTMLButtonElement>('[data-stage-current]')!

    await act(async () => {
      fireEvent.click(trigger)
    })
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(container.querySelector('[data-stage-menu]')).toBeNull()

    await act(async () => {
      fireEvent.click(trigger)
    })
    await act(async () => {
      fireEvent.pointerDown(document.body)
    })
    expect(container.querySelector('[data-stage-menu]')).toBeNull()

    await act(async () => {
      fireEvent.click(trigger)
    })
    // The row for the stage already in force is inert, so the pick targets an
    // unselected row.
    const row = optionsOf(container)[0]!
    await act(async () => {
      fireEvent.click(row)
    })
    expect(container.querySelector('[data-stage-menu]')).toBeNull()
    expect(switchStage).toHaveBeenCalledWith(STAGE_NAMES.first)
  })

  it('locks the trigger while a switch runs and parks back on the stage in force', async () => {
    let resolveSwitch: (outcome: StageSwitchOutcome) => void = () => {}
    const switchStage = vi.fn(() => new Promise<StageSwitchOutcome>(resolve => { resolveSwitch = resolve }))
    const { container } = bodyOf({
      current: STAGE_NAMES.second,
      records: [
        { stage: STAGE_NAMES.first, seq: 1, time: 0, switched: false },
        { stage: STAGE_NAMES.second, seq: 2, time: 0, switched: true },
      ],
    }, switchStage)
    const trigger = container.querySelector<HTMLButtonElement>('[data-stage-current]')!
    await act(async () => {
      fireEvent.click(trigger)
    })
    await act(async () => {
      fireEvent.click(optionsOf(container)[0]!)
    })
    expect(switchStage).toHaveBeenCalledWith(STAGE_NAMES.first)
    // The pick is held (and the control locked) until the command settles.
    expect(trigger.disabled).toBe(true)
    await act(async () => {
      resolveSwitch({ ok: true })
    })
    // The static test view still folds the old current, so the trigger parks
    // back on it — the live fold takes over in a real session.
    expect(trigger.disabled).toBe(false)
    expect(trigger.textContent).toBe(STAGE_NAMES.second)
    expect(container.querySelector('[data-stage-failure]')).toBeNull()
  })

  it('shows the failure line and parks back on the stage in force when the switch fails', async () => {
    const switchStage = vi.fn(() => Promise.resolve({ ok: false, reason: 'unavailable' } as StageSwitchOutcome))
    const { container } = bodyOf({
      current: STAGE_NAMES.second,
      records: [
        { stage: STAGE_NAMES.first, seq: 1, time: 0, switched: false },
        { stage: STAGE_NAMES.second, seq: 2, time: 0, switched: true },
      ],
    }, switchStage)
    const trigger = container.querySelector<HTMLButtonElement>('[data-stage-current]')!
    await act(async () => {
      fireEvent.click(trigger)
    })
    await act(async () => {
      fireEvent.click(optionsOf(container)[0]!)
    })
    expect(switchStage).toHaveBeenCalledWith(STAGE_NAMES.first)
    expect(container.querySelector('[data-stage-failure]')?.textContent).toBe(zh.switchUnavailable)
    expect(trigger.textContent).toBe(STAGE_NAMES.second)
    expect(trigger.disabled).toBe(false)
  })
})
