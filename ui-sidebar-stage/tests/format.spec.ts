/**
 * Presentation formatting: stable durations, compact token counts, pressure
 * clamping, and the per-stage identity accent.
 */
import { describe, expect, it } from 'vitest'
import { contextPercent, formatDuration, formatTokens, stageAccent } from '../src/client/format.ts'
import { STAGE_NAMES } from './helpers.ts'

describe('formatDuration', () => {
  it('renders seconds, minutes, and hours compactly', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(42_900)).toBe('42s')
    expect(formatDuration(761_000)).toBe('12m 41s')
    expect(formatDuration(3_840_000)).toBe('1h 04m')
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
