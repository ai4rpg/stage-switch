/**
 * The stage view source: it borrows the session binding's event window on
 * the first subscriber, folds every mutation into a fresh snapshot, and
 * detaches (and resets) on the last unsubscribe.
 */
import { describe, expect, it, vi } from 'vitest'
import { STAGE_NAMES } from './helpers.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionEventLikeEntry, SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import { createStageSource } from '../src/client/store.ts'

/** Hand-rolled event window the tests mutate directly. */
class FakeWindow {
  private readonly listeners = new Set<() => void>()
  private entries: readonly SessionEventLikeEntry[] = []

  readonly eventSource = {
    getSnapshot: (): SessionEventWindow => ({ entries: this.entries, hasMore: false, revision: 0, change: { kind: 'append', entries: this.entries } } as SessionEventWindow),
    subscribe: (listener: () => void) => {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    },
  }

  push(event: SessionEvent): void {
    this.entries = [...this.entries, { type: 'event', event }]
    for (const listener of [...this.listeners]) listener()
  }
}

function stageNotice(seq: number, summary: string): SessionEvent {
  return {
    type: 'user/message',
    seq,
    time: 1_700_000_000_000 + seq,
    data: { id: `m-${seq}`, content: [{ type: 'text', text: 'x' }], source: { kind: 'stage-switch', form: 'notice', summary } },
  } as unknown as SessionEvent
}

describe('createStageSource', () => {
  it('folds the window on attach and follows every mutation', () => {
    const window = new FakeWindow()
    window.push(stageNotice(1, `Current stage: ${STAGE_NAMES.first}`))
    const binding = vi.fn(() => ({ sessionId: 's-1', eventSource: window.eventSource }))
    const source = createStageSource({ binding } as never, 's-1' as never)

    expect(source.getSnapshot().records).toEqual([])
    const listener = vi.fn()
    const unsubscribe = source.subscribe(listener)

    expect(source.getSnapshot().current).toBe(STAGE_NAMES.first)
    expect(source.getSnapshot().records).toHaveLength(1)
    expect(binding).toHaveBeenCalledTimes(1)

    window.push(stageNotice(2, `Stage switched to ${STAGE_NAMES.second}`))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(source.getSnapshot().current).toBe(STAGE_NAMES.second)
    expect(source.getSnapshot().records.map(record => [record.stage, record.switched])).toEqual([
      [STAGE_NAMES.first, false],
      [STAGE_NAMES.second, true],
    ])
    unsubscribe()
  })

  it('detaches on the last unsubscribe and reattaches fresh on the next', () => {
    const window = new FakeWindow()
    window.push(stageNotice(1, `Current stage: ${STAGE_NAMES.first}`))
    const source = createStageSource({ binding: () => ({ eventSource: window.eventSource }) } as never, 's-1' as never)

    const unsubscribe = source.subscribe(() => {})
    expect(source.getSnapshot().current).toBe(STAGE_NAMES.first)
    unsubscribe()
    expect(source.getSnapshot().records).toEqual([])

    window.push(stageNotice(2, `Stage switched to ${STAGE_NAMES.second}`))
    const unsubscribeAgain = source.subscribe(() => {})
    expect(source.getSnapshot().records).toHaveLength(2)
    expect(source.getSnapshot().current).toBe(STAGE_NAMES.second)
    unsubscribeAgain()
  })

  it('stays empty while no binding exists and attaches when one appears', () => {
    let window: FakeWindow | undefined
    const source = createStageSource({ binding: () => window?.eventSource && { eventSource: window.eventSource } } as never, 's-1' as never)

    const unsubscribe = source.subscribe(() => {})
    expect(source.getSnapshot().records).toEqual([])
    unsubscribe()

    window = new FakeWindow()
    window.push(stageNotice(1, `Current stage: ${STAGE_NAMES.third}`))
    const unsubscribeAgain = source.subscribe(() => {})
    expect(source.getSnapshot().current).toBe(STAGE_NAMES.third)
    unsubscribeAgain()
  })
})
