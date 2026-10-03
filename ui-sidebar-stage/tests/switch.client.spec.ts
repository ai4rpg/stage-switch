/**
 * The switch action: `/stage <name>` through the session binding's command
 * face, with the outcome classified for the tab's failure line.
 */
import { describe, expect, it, vi } from 'vitest'
import { STAGE_NAMES } from './helpers.ts'
import { createStageSwitcher } from '../src/client/switch.ts'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

type Command = (line: string) => Promise<{ ok: true; value: { matched: boolean } } | { ok: false; error: { message: string } }>

function sessionsWith(command: Command | undefined): ISessions {
  return {
    binding: vi.fn(() => command === undefined
      ? undefined
      : { session: { command } }),
  } as unknown as ISessions
}

describe('createStageSwitcher', () => {
  const SESSION = 's-1' as SessionId

  it('submits `/stage <stage>` through the binding session command face', async () => {
    const command = vi.fn(() => Promise.resolve({ ok: true, value: { matched: true } })) as unknown as Command
    const switchStage = createStageSwitcher(sessionsWith(command), SESSION)
    await expect(switchStage(STAGE_NAMES.target)).resolves.toEqual({ ok: true })
    expect(command).toHaveBeenCalledWith(`/stage ${STAGE_NAMES.target}`)
  })

  it('classifies an unmatched command as unavailable (stage-switch not mounted)', async () => {
    const command = vi.fn(() => Promise.resolve({ ok: true, value: { matched: false } })) as unknown as Command
    const switchStage = createStageSwitcher(sessionsWith(command), SESSION)
    await expect(switchStage(STAGE_NAMES.target)).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })

  it('classifies a missing binding as unavailable', async () => {
    const switchStage = createStageSwitcher(sessionsWith(undefined), SESSION)
    await expect(switchStage(STAGE_NAMES.target)).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })

  it('carries the Remote failure message on the error branch', async () => {
    const command = vi.fn(() => Promise.resolve({ ok: false, error: { message: 'session/writer-held' } })) as unknown as Command
    const switchStage = createStageSwitcher(sessionsWith(command), SESSION)
    await expect(switchStage(STAGE_NAMES.target)).resolves.toEqual({ ok: false, reason: 'failed', message: 'session/writer-held' })
  })

  it('folds a thrown transport error into the failed branch', async () => {
    const command = vi.fn(() => Promise.reject(new Error('transport closed'))) as unknown as Command
    const switchStage = createStageSwitcher(sessionsWith(command), SESSION)
    const outcome = await switchStage(STAGE_NAMES.target)
    expect(outcome).toEqual({ ok: false, reason: 'failed', message: 'Error: transport closed' })
  })
})
