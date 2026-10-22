/**
 * Layout contract for the tab's fixed-height column.
 *
 * jsdom has no layout engine, so the component tests can pin the DOM structure
 * but not computed overflow. These source-level assertions keep the rules that
 * prevent a long journey from growing past the sidebar pane: the root fills the
 * pane, the journey is the primary scroll region, and a pane too short for the
 * fixed blocks makes the root scroll rather than clipping the switch button.
 */
import { describe, expect, it } from 'vitest'
import { STAGE_CSS } from '../src/client/styles.ts'

/** The declaration block of the first rule with one exact selector. */
function rule(selector: string): string {
  const match = new RegExp(`${selector.replaceAll('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(STAGE_CSS)
  if (match?.[1] === undefined) throw new Error(`missing CSS rule: ${selector}`)
  return match[1]
}

describe('stage tab layout', () => {
  it('fills the pane and never clips an unreachable control', () => {
    const root = rule('.ui-stage-root')
    expect(root).toContain('height: 100%')
    expect(root).toContain('min-height: 0')
    // `overflow: hidden` would clip the switch button on a pane shorter than
    // the fixed blocks, with no way to scroll to it.
    expect(root).toContain('overflow-y: auto')
    expect(root).not.toContain('overflow: hidden')
  })

  it('scrolls the journey first, with a floor before the root scrolls', () => {
    const journey = rule('.ui-stage-journey-scroll')
    expect(journey).toContain('flex: 1 1 auto')
    expect(journey).toContain('overflow-y: auto')
    // A positive floor (not `min-height: 0`) is what makes the root overflow —
    // and therefore scroll — when the pane cannot fit the fixed blocks.
    expect(journey).toMatch(/min-height: (?!0\b)\d+px/)
  })
})
