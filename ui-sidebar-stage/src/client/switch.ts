/**
 * The stage switch action: submit `/stage <name>` through the session's
 * command face — the same command the chat input runs, so the switch lands
 * through the host's own admission, its idle-commit/queued boundary, and its
 * durable record (the fold picks the record up and the tab re-renders).
 *
 * The stage CATALOG stays host/preset-owned: the client never learns it. The
 * tab offers only the stages this session has already recorded, so the
 * dropdown is honest about what it can know without a Host RPC for state.
 * Stage names come from the fold, whose summary grammar
 * (`[a-z][a-z0-9_-]*`) excludes whitespace and slashes, so interpolating one
 * into the command line cannot smuggle a second argument.
 */
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** What one switch attempt resolved to. */
export type StageSwitchOutcome =
  | { readonly ok: true }
  /** The `/stage` command is absent (stage-switch not mounted) or the session has no client binding. */
  | { readonly ok: false; readonly reason: 'unavailable' }
  /** The command ran and refused, or the Remote call failed. */
  | { readonly ok: false; readonly reason: 'failed'; readonly message: string }

/**
 * Create the per-session switch action.
 *
 * @param sessions - the session-controller client service.
 * @param sessionId - the session whose stages are switched.
 * @returns an async action: submit `/stage <stage>` and classify the outcome.
 */
export function createStageSwitcher(
  sessions: ISessions,
  sessionId: SessionId,
): (stage: string) => Promise<StageSwitchOutcome> {
  return async (stage: string): Promise<StageSwitchOutcome> => {
    const session = sessions.binding(sessionId)?.session
    if (session === undefined) return { ok: false, reason: 'unavailable' }
    let result: Awaited<ReturnType<typeof session.command>>
    try {
      result = await session.command(`/stage ${stage}`)
    } catch (error) {
      return { ok: false, reason: 'failed', message: String(error) }
    }
    if (!result.ok) return { ok: false, reason: 'failed', message: result.error.message }
    // `matched: false` is the admission answer for an unknown command: the
    // host composition never mounted stage-switch's `/stage`.
    if (!result.value.matched) return { ok: false, reason: 'unavailable' }
    return { ok: true }
  }
}
