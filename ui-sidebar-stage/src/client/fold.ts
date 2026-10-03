/**
 * Client-side copy of the stage-record fold contract.
 *
 * The source of truth is `@ai4rpg/dsh-stage-switch`'s exported
 * `STAGE_SOURCE_KINDS` / `STAGE_SUMMARY`; `tests/contract-pin.spec.ts` pins
 * this copy against it byte-for-byte. The copy exists because a browser
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

/**
 * Fold the stage records out of a session event window.
 *
 * Mirrors the Host's `stageFromEvent` reading: both producer kinds (current
 * writes and the V3→V4 migration's `plugin:stage-switch` rename) fold, and a
 * summary that does not match the contract is not a stage record.
 * @param entries - window entries (durable events and transient chunks).
 * @returns the stage records in log order.
 */
export function foldStageRecords(entries: readonly SessionEventLikeEntry[]): readonly StageRecord[] {
  const records: StageRecord[] = []
  for (const entry of entries) {
    if (entry.type !== 'event') continue
    const event = entry.event
    if (event.type !== 'user/message') continue
    const record = recordOf(event.data.source as RecordSource)
    if (record === undefined) continue
    records.push({ ...record, seq: event.seq, time: event.time })
  }
  return records
}
