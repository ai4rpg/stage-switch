/**
 * The ambient stage pill above the message composer.
 *
 * It is a compact view of the Host `stage` wire view — stage identity dot,
 * name, time in stage, and the live/idle pulse — and a shortcut back to the
 * stage tab. It renders nothing when the wire view is absent (an older host
 * or a session whose composition never mounted stage-switch); unlike the tab
 * it does not carry a client fold, so a session that always has the pill does
 * not pay for a per-event window scan.
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the conversation input-dock slot into this package's slot catalog.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { useStageWire } from './wire.ts'
import { formatDuration, stageAccent } from './format.ts'
import { stageLabel } from './present.ts'

/** Props supplied to the composer-dock entry. */
export interface StageDockProps
  extends PropsRuntime<'conversation.input.dock'>, PropsLocale<'sidebarStage'> {
  /** Open (or focus) the stage tab for this session. */
  readonly openStage: () => void
}

/** The chevron that marks the pill as a way back to the tab. */
function ChevronGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Render the composer-dock stage pill. */
export function StageDock({
  useProjection,
  useSession,
  openStage,
  t,
}: StageDockProps) {
  const wire = useStageWire(useProjection)
  const running = useSession(state => state.running)
  const [now, setNow] = useState(() => Date.now())
  const mounted = wire !== undefined

  useEffect(() => {
    if (!mounted) return
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [mounted])

  if (wire === undefined) return null
  const catalogEntry = wire.stages.find(candidate => candidate.name === wire.stage)
  const label = catalogEntry === undefined ? wire.stage : stageLabel(catalogEntry)
  const entry = wire.history.at(-1)
  const elapsed = entry?.time === undefined ? undefined : formatDuration(Math.max(0, now - entry.time))
  return (
    <div className="ui-stage-dock">
      <button
        type="button"
        className="ui-stage-dock-bar"
        data-stage-dock=""
        aria-label={`${t('openStage')}: ${label}`}
        onClick={openStage}
        style={{ '--ui-stage-dock-color': stageAccent(wire.stage, wire.stages) } as CSSProperties}
      >
        <span
          className={`ui-stage-dock-dot${running ? ' ui-stage-dock-dot--live' : ''}`}
          aria-hidden="true"
        />
        <span className="ui-stage-dock-name">{label}</span>
        <span className="ui-stage-dock-meta">
          {elapsed === undefined ? t('notStarted') : elapsed}
        </span>
        <span className="ui-stage-dock-spacer" />
        <span className="ui-stage-dock-chevron"><ChevronGlyph /></span>
      </button>
    </div>
  )
}
