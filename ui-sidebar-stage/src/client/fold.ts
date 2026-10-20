/**
 * Client-side copy of the stage-record fold contract, plus the fallback fold
 * that renders sessions whose composition never mounted stage-switch (or an
 * older host whose `stage` projection has no client wire view).
 *
 * The source of truth for the record grammar is `@ai4rpg/dsh-stage-switch`'s
 * exported `STAGE_SOURCE_KINDS` / `STAGE_SUMMARY`; `tests/contract-pin.spec.ts`
 * pins this copy against it byte-for-byte. The copy exists because a browser
 * bundle may only require module-table baseline specifiers, and the
 * stage-switch package is a Host plugin, not a client module.
 */
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'

/** Producer kinds a durable stage record can carry (pinned to the host export). */
export const STAGE_SOURCE_KINDS: ReadonlySet<string> = new Set(['stage-switch', 'plugin:stage-switch'])

/** The `notice` summary a stage record carries (pinned to the host export). */
export const STAGE_SUMMARY = /^(?:Current stage: |Stage switched to )([a-z][a-z0-9_-]*)$/

/** One durable stage record as the tab presents it. */
export interface StageRecord {
  /** The stage the session entered. */
  readonly stage: string
  /** Monotonic session sequence number of the record. */
  readonly seq: number
  /** Unix epoch milliseconds of the record. */
  readonly time: number
  /** Whether the record marks a transition (`Stage switched to`) rather than a session-start entry. */
  readonly switched: boolean
  /** The instruction body the stage prompt carried, when the record is a prompt. */
  readonly instruction: string | undefined
  /** Non-stage user messages plus assistant messages after this record. */
  readonly messages: number
  /** `tool/call` events after this record. */
  readonly tools: number
  /** Provider-reported tokens accumulated after this record. */
  readonly tokens: number
  /** Failed `tool/result` events after this record. */
  readonly errors: number
}

/** The source fields a stage record's `user/message` event carries. */
interface RecordSource {
  readonly kind?: unknown
  readonly form?: unknown
  readonly summary?: unknown
}

/** Read the stage a record's summary names, or undefined for any other message. */
function recordOf(source: RecordSource): { stage: string, switched: boolean } | undefined {
  if (typeof source.kind !== 'string' || !STAGE_SOURCE_KINDS.has(source.kind)) return undefined
  if (source.form !== 'notice' || typeof source.summary !== 'string') return undefined
  const stage = STAGE_SUMMARY.exec(source.summary)?.[1]
  if (stage === undefined) return undefined
  return { stage, switched: source.summary.startsWith('Stage switched to ') }
}

/** The text of one user message, joined from its text blocks. */
function textOf(content: readonly { readonly type: string, readonly text?: string }[]): string {
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('')
}

/**
 * The instruction after the load-bearing `Current stage: <name>` line.
 * A narrated user switch or a handoff notice may precede the stage-prompt
 * body, so the marker is located anywhere in the message text, not only at
 * the start. The line prefix itself is the host contract's format; the rest
 * is deployment copy and may be empty.
 */
function instructionOf(content: readonly { readonly type: string, readonly text?: string }[], stage: string): string | undefined {
  const text = textOf(content)
  const marker = `Current stage: ${stage}`
  const index = text.indexOf(marker)
  if (index < 0) return undefined
  const body = text.slice(index + marker.length).replace(/^\r?\n/, '').trim()
  return body === '' ? undefined : body
}

/** Per-event counter contribution for the current stage record. */
interface MetricDelta {
  readonly messages?: number
  readonly tools?: number
  readonly tokens?: number
  readonly errors?: number
}

/** Counters one durable event adds to the current stage record. */
function metricOf(event: Extract<SessionEventLikeEntry, { readonly type: 'event' }>['event']): MetricDelta | undefined {
  switch (event.type) {
    case 'user/message':
      // A stage record is a notice, not a message; only non-record user
      // messages count (synthetic context injections included, as the chat
      // transcript renders them).
      return recordOf(event.data.source) === undefined ? { messages: 1 } : undefined
    case 'assistant/message': {
      const usage = event.data.usage
      if (usage === undefined) return { messages: 1 }
      const tokens = usage.totalTokens ?? usage.inputTokens + usage.outputTokens
      return { messages: 1, ...tokens === 0 ? {} : { tokens } }
    }
    case 'tool/call':
      return { tools: 1 }
    case 'tool/result':
      return event.data.error === undefined ? undefined : { errors: 1 }
    default:
      return undefined
  }
}

/** Apply one event's counters to a stage record. */
function withMetrics(record: StageRecord, delta: MetricDelta): StageRecord {
  return {
    ...record,
    messages: record.messages + (delta.messages ?? 0),
    tools: record.tools + (delta.tools ?? 0),
    tokens: record.tokens + (delta.tokens ?? 0),
    errors: record.errors + (delta.errors ?? 0),
  }
}

/**
 * Fold the stage records out of a session event window.
 *
 * Mirrors the Host's `stageFromEvent` reading: both producer kinds (current
 * writes and the V3→V4 migration's `plugin:stage-switch` rename) fold, and a
 * summary that does not match the contract is not a stage record. The same
 * pass accumulates the per-stage counters and extracts the stage-prompt
 * instruction, so the fallback view matches the Host projection's wire view
 * without a second scan.
 * @param entries - window entries (durable events and transient chunks).
 * @returns the stage records in log order, with their metrics.
 */
export function foldStageRecords(entries: readonly SessionEventLikeEntry[]): readonly StageRecord[] {
  const records: StageRecord[] = []
  for (const entry of entries) {
    if (entry.type !== 'event') continue
    const event = entry.event
    if (event.type === 'user/message') {
      const record = recordOf(event.data.source)
      if (record !== undefined) {
        records.push({
          ...record,
          seq: event.seq,
          time: event.time,
          instruction: instructionOf(event.data.content, record.stage),
          messages: 0,
          tools: 0,
          tokens: 0,
          errors: 0,
        })
        continue
      }
    }
    const delta = metricOf(event)
    const current = records[records.length - 1]
    if (delta !== undefined && current !== undefined) {
      records[records.length - 1] = withMetrics(current, delta)
    }
  }
  return records
}
