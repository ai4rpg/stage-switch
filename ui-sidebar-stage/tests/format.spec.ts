/**
 * Presentation formatting: stable durations, compact token counts, pressure
 * clamping, and the per-stage identity accent.
 */
import { describe, expect, it } from 'vitest'
import { activeDuration, contextPercent, formatDuration, formatTokens, stageAccent } from '../src/client/format.ts'
import { STAGE_NAMES } from './helpers.ts'

describe('formatDuration', () => {
  it('renders seconds, minutes, and hours compactly', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(42_900)).toBe('42s')
    expect(formatDuration(761_000)).toBe('12m 41s')
    expect(formatDuration(3_840_000)).toBe('1h 04m')
  })
})

describe('activeDuration', () => {
  it('has no value when the source predates active-turn timing', () => {
    expect(activeDuration({}, true, 10_000)).toBeUndefined()
  })

  it('returns settled turn time when no turn is open', () => {
    expect(activeDuration({ activeMs: 12_000 }, true, 10_000)).toBe(12_000)
  })

  it('advances the open window while running and freezes at the newest folded event when idle', () => {
    const timing = { activeMs: 5_000, active: { since: 20_000, through: 23_000 } }
    expect(activeDuration(timing, true, 30_000)).toBe(15_000)
    // Idle: the clock stops at `through`, not at the current wall time.
    expect(activeDuration(timing, false, 60_000)).toBe(8_000)
  })

  it('clamps a window whose start is ahead of the clock', () => {
    const timing = { activeMs: 5_000, active: { since: 20_000, through: 19_000 } }
    expect(activeDuration(timing, true, 18_000)).toBe(5_000)
    expect(activeDuration(timing, false, 18_000)).toBe(5_000)
  })
})

describe('formatTokens', () => {
  it('renders compact counts without a spurious .0', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_000)).toBe('1k')
    expect(formatTokens(1_200)).toBe('1.2k')
    expect(formatTokens(12_400)).toBe('12.4k')
    expect(formatTokens(1_200_000)).toBe('1.2m')
  })
})

describe('contextPercent', () => {
  it('clamps a pressure ratio and hides an absent capacity', () => {
    expect(contextPercent(38, 100)).toBe(38)
    expect(contextPercent(120, 100)).toBe(100)
    expect(contextPercent(undefined, 100)).toBeUndefined()
    expect(contextPercent(38, 0)).toBeUndefined()
  })
})

describe('stageAccent', () => {
  it('is stable for the same catalog position and unknown name', () => {
    const catalog = [{ name: STAGE_NAMES.first }, { name: STAGE_NAMES.second }]
    expect(stageAccent(STAGE_NAMES.first, catalog)).toBe(stageAccent(STAGE_NAMES.first, catalog))
    expect(stageAccent(STAGE_NAMES.second, catalog)).not.toBe(stageAccent(STAGE_NAMES.first, catalog))
    expect(stageAccent('unknown-stage', catalog)).toBe(stageAccent('unknown-stage', catalog))
  })
})
