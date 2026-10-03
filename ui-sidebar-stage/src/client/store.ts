/**
 * Per-session stage view: a lazily-attached observable over the session
 * binding's event window.
 *
 * The stage records are durable `user/message` notices the conversation
 * already renders, so the tab folds them client-side and needs no Host RPC —
 * which also keeps the view alive for idle and resumed sessions (a
 * `serviceFor`-style bridge needs a live Agent and answers nothing for an
 * idle one).
 */
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { foldStageRecords, type StageRecord } from './fold.ts'

/** What the tab body renders. */
export interface StageView {
  /** The session's current stage, or undefined before the first record. */
  readonly current: string | undefined
  /** Every stage record in log order. */
  readonly records: readonly StageRecord[]
}

const EMPTY: StageView = { current: undefined, records: [] }

/**
 * Create the stage view source for one session.
 *
 * The source attaches to the session binding's event window on its first
 * subscriber and detaches on the last unsubscribe, so an unmounted tab body
 * costs nothing. The binding is borrowed (`ISessions.binding`), never
 * retained: a session-scoped tab only renders while its session is live, and
 * the application already holds that reference. When no binding exists yet
 * the source stays empty and retries on the next attach.
 * @param sessions - the session-controller client service.
 * @param sessionId - the session whose stage records to fold.
 * @returns an observable snapshot of the folded view.
 */
export function createStageSource(sessions: ISessions, sessionId: SessionId): HostObservable<StageView> {
  const listeners = new Set<() => void>()
  let snapshot = EMPTY
  let detach: (() => void) | undefined

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try { listener() }
      catch (error) { console.error('ui-sidebar-stage subscriber failed:', error) }
    }
  }

  const attach = (): void => {
    const binding = sessions.binding(sessionId)
    if (binding === undefined) return
    const publish = (): void => {
      const window = binding.eventSource.getSnapshot()
      const records = foldStageRecords(window.entries)
      snapshot = { current: records.at(-1)?.stage, records }
    }
    publish()
    const unsubscribe = binding.eventSource.subscribe(() => {
      publish()
      notify()
    })
    detach = () => {
      unsubscribe()
      snapshot = EMPTY
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      if (listeners.size === 1) attach()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && detach !== undefined) {
          detach()
          detach = undefined
        }
      }
    },
  }
}
