/**
 * The fold contract pin: the client copy must match the Host package's
 * exported source of truth byte-for-byte. The summary format and the
 * producer kinds are a cross-package contract (the Host's `foldStage` and
 * the V3→V4 migration both depend on them); this test is what makes a silent
 * drift on either side a build failure instead of a dead tab.
 */
import { describe, expect, it } from 'vitest'
import { STAGE_SOURCE_KINDS as HOST_KINDS, STAGE_SUMMARY as HOST_SUMMARY } from '@ai4rpg/dsh-stage-switch/src/index.ts'
import { STAGE_SOURCE_KINDS, STAGE_SUMMARY } from '../src/client/fold.ts'

describe('stage fold contract pin', () => {
  it('matches the host package\'s exported contract', () => {
    expect([...STAGE_SOURCE_KINDS].sort()).toEqual([...HOST_KINDS].sort())
    expect(STAGE_SUMMARY.source).toBe(HOST_SUMMARY.source)
    expect(STAGE_SUMMARY.flags).toBe(HOST_SUMMARY.flags)
  })
})
