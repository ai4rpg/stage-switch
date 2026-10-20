/**
 * The fold: both producer kinds read, everything else ignored, and the
 * summary contract decides what is a stage record.
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session/types'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { foldStageRecords } from '../src/client/fold.ts'

type UserMessageEvent = SessionEvent<'user/message'>

function userMessage(seq: number, source: unknown, text = `body ${seq}`): UserMessageEvent {
  return {
    type: 'user/message',
    seq,
    time: 1_700_000_000_000 + seq,
    data: { id: `m-${seq}`, content: [{ type: 'text', text }], source },
  } as unknown as UserMessageEvent
}

function entry(event: SessionEvent<keyof SessionEventMap>): SessionEventLikeEntry {
  return { type: 'event', event }
}

describe('foldStageRecords', () => {
  it('folds records of both producer kinds with their stage and switch flag', () => {
    const records = foldStageRecords([
      entry(userMessage(1, { kind: 'stage-switch', form: 'notice', summary: 'Current stage: stage-a' })),
      entry(userMessage(2, { kind: 'plugin:stage-switch', form: 'notice', summary: 'Stage switched to stage-b' })),
    ])
    expect(records).toEqual([
      {
        stage: 'stage-a',
        seq: 1,
        time: 1_700_000_000_001,
        switched: false,
        instruction: undefined,
        messages: 0,
        tools: 0,
        tokens: 0,
        errors: 0,
      },
      {
        stage: 'stage-b',
        seq: 2,
        time: 1_700_000_000_002,
        switched: true,
        instruction: undefined,
        messages: 0,
        tools: 0,
        tokens: 0,
        errors: 0,
      },
    ])
  })

  it('extracts the stage instruction and accumulates the per-stage counters', () => {
    const records = foldStageRecords([
      entry(userMessage(
        1,
        { kind: 'stage-switch', form: 'notice', summary: 'Current stage: stage-a' },
        'Current stage: stage-a\nDo stage-a.',
      )),
      entry(userMessage(2, { kind: 'user' })),
      entry({
        type: 'assistant/message',
        seq: 3,
        time: 1_700_000_000_003,
        data: { turn: 1, step: 1, message: {}, stream: [], usage: { inputTokens: 10, outputTokens: 5 } },
      } as unknown as SessionEvent<'assistant/message'>),
      entry({
        type: 'tool/call',
        seq: 4,
        time: 1_700_000_000_004,
        data: { turn: 1, step: 1, callId: 'c-1', name: 'bash', arguments: '{}' },
      } as unknown as SessionEvent<'tool/call'>),
      entry({
        type: 'tool/result',
        seq: 5,
        time: 1_700_000_000_005,
        data: { turn: 1, step: 1, message: {}, error: { name: 'TestError', code: 'TEST' } },
      } as unknown as SessionEvent<'tool/result'>),
    ])
    expect(records).toEqual([{
      stage: 'stage-a',
      seq: 1,
      time: 1_700_000_000_001,
      switched: false,
      instruction: 'Do stage-a.',
      messages: 2,
      tools: 1,
      tokens: 15,
      errors: 1,
    }])
  })

  it('ignores human messages, other producers, and transient entries', () => {
    const records = foldStageRecords([
      entry(userMessage(1, { kind: 'user' })),
      entry(userMessage(2, { kind: 'plugin', plugin: 'stage-switch', form: 'notice', summary: 'Current stage: stage-a' })),
      entry(userMessage(3, { kind: 'compact-checkpoint' })),
      { type: 'transient', event: { type: 'assistant/live-chunk', seq: 4, time: 0, data: {} } } as unknown as SessionEventLikeEntry,
      entry({ type: 'turn/start', seq: 5, time: 0, data: { turn: 1 } } as SessionEvent<'turn/start'>),
    ])
    expect(records).toEqual([])
  })

  it('ignores stage-source notices whose summary breaks the contract', () => {
    const records = foldStageRecords([
      entry(userMessage(1, { kind: 'stage-switch', form: 'notice', summary: 'bogus' })),
      entry(userMessage(2, { kind: 'stage-switch', form: 'notice', summary: 'Current stage: Not A Stage!' })),
      entry(userMessage(3, { kind: 'stage-switch', form: 'prompt', summary: 'Current stage: stage-a' })),
      entry(userMessage(4, { kind: 'stage-switch', form: 'notice' })),
    ])
    expect(records).toEqual([])
  })
})
