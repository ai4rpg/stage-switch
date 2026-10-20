/**
 * The stage tab: an Atlas-style journey instead of the old capsule + flat
 * history.
 *
 * The body prefers the Host `stage` projection's wire view (complete catalog,
 * recorded journey, and per-stage counters, all folded host-side); when that
 * capability is absent it falls back to the client fold of the session event
 * window. The switch action is the same `/stage <name>` command the chat input
 * runs, so the palette can offer the full route, visited stages, and a typed
 * custom stage without the client knowing the host catalog at build time.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { StageView } from './store.ts'
import type { StageSwitchOutcome } from './switch.ts'
import type { StageCatalogEntry, StageSegment } from './present.ts'
import { presentStages, stageLabel } from './present.ts'
import { useContextPressure, useStageWire } from './wire.ts'
import { contextPercent, formatClock, formatDuration, formatTokens, isMacPlatform, stageAccent } from './format.ts'
import { StagePalette } from './StagePalette.tsx'

/** Props supplied to the stage tab body. */
export interface StageBodyProps
  extends PropsRuntime<'sidebar.right.pane.tab'>, PropsLocale<'sidebarStage'> {
  /** Stage view selector injected by this package's registration. */
  readonly useStage: SnapshotSelectorHook<StageView>
  /** Switch action injected by this package's registration. */
  readonly switchStage: (stage: string) => Promise<StageSwitchOutcome>
}

/** Clock glyph for the "in stage" line. */
function ClockGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 4.8V8l2.1 1.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** The switch glyph on the palette trigger. */
function SwitchGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.2 2.8 2.4 4.6l1.8 1.8M2.6 4.6h8.2M11.8 13.2l1.8-1.8-1.8-1.8M13.4 11.4H5.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The hover hint arrow. */
function ArrowGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8h9M8.6 4.6 12 8l-3.4 3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The empty-state compass action. */
function CompassGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="m10.2 5.8-1.4 3-3 1.4 1.4-3 3-1.4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

/** The duration of one visit, ended by the next visit or the live clock. */
function durationOf(segments: readonly StageSegment[], segment: StageSegment, now: number): number | undefined {
  if (segment.time === undefined) return undefined
  const index = segments.indexOf(segment)
  const next = index >= 0 ? segments[index + 1] : undefined
  return next?.time === undefined ? Math.max(0, now - segment.time) : Math.max(0, next.time - segment.time)
}

/** One journey row: a switchable visit or the inert current one. */
function JourneyRow({
  segment,
  catalog,
  segments,
  now,
  pending,
  onSwitch,
  t,
}: {
  readonly segment: StageSegment
  readonly catalog: readonly StageCatalogEntry[]
  readonly segments: readonly StageSegment[]
  readonly now: number
  readonly pending: boolean
  readonly onSwitch: (stage: string) => void
  readonly t: StageBodyProps['t']
}) {
  const live = segment.live
  const accent = stageAccent(segment.stage, catalog)
  const duration = durationOf(segments, segment, now)
  const time = segment.time === undefined ? t('notStarted') : formatClock(segment.time)
  const metrics = segment.time === undefined
    ? t('notStarted')
    : [
      duration === undefined ? undefined : formatDuration(duration),
      `${String(segment.messages)} ${t('messagesShort')}`,
      `${String(segment.tools)} ${t('toolsShort')}`,
    ].filter((part): part is string => part !== undefined).join(' · ')
  const content = (
    <>
      <span className="ui-stage-node" aria-hidden="true" />
      <div className="ui-stage-row-top">
        <span className="ui-stage-row-name">{segment.label}</span>
        {live && <span className="ui-stage-now">{t('now')}</span>}
        <span className="ui-stage-spacer" />
        <span className="ui-stage-row-time">{segment.time === undefined ? '—' : time}</span>
      </div>
      <div className="ui-stage-row-meta">
        <span>{metrics}</span>
        {segment.errors > 0 && <span className="ui-stage-error-ink">· {String(segment.errors)} {t('errorsShort')}</span>}
      </div>
      {!live && (
        <span className="ui-stage-row-hint">{t('switchRow')} <ArrowGlyph /></span>
      )}
    </>
  )
  const classes = [
    'ui-stage-row',
    live ? 'ui-stage-row--current' : 'ui-stage-row--done',
    !live && !pending ? 'ui-stage-row--switchable' : '',
  ].filter(Boolean).join(' ')
  return (
    <li
      className={classes}
      style={{ '--ui-stage-node': accent } as CSSProperties}
      aria-current={live ? 'step' : undefined}
    >
      {live || pending
        ? <div className="ui-stage-row-button">{content}</div>
        : (
          <button
            type="button"
            className="ui-stage-row-button"
            aria-label={`${t('switchTo')} ${segment.label}`}
            onClick={() => { onSwitch(segment.stage) }}
          >
            {content}
          </button>
        )}
    </li>
  )
}

/** One future catalog node: not yet recorded, still switchable. */
function FutureRow({
  entry,
  catalog,
  pending,
  onSwitch,
  t,
}: {
  readonly entry: StageCatalogEntry
  readonly catalog: readonly StageCatalogEntry[]
  readonly pending: boolean
  readonly onSwitch: (stage: string) => void
  readonly t: StageBodyProps['t']
}) {
  const accent = stageAccent(entry.name, catalog)
  const content = (
    <>
      <span className="ui-stage-node" aria-hidden="true" />
      <div className="ui-stage-row-top">
        <span className="ui-stage-row-name">{stageLabel(entry)}</span>
        <span className="ui-stage-spacer" />
        <span className="ui-stage-row-time">—</span>
      </div>
      <div className="ui-stage-row-meta">
        <span>{t('notVisited')}</span>
        <span className="ui-stage-row-dot" />
        <span>{t('nextUp')}</span>
      </div>
      {!pending && <span className="ui-stage-row-hint">{t('switchRow')} <ArrowGlyph /></span>}
    </>
  )
  return (
    <li
      className={[
        'ui-stage-row',
        'ui-stage-row--future',
        pending ? '' : 'ui-stage-row--switchable',
      ].filter(Boolean).join(' ')}
      style={{ '--ui-stage-node': accent } as CSSProperties}
    >
      {pending
        ? <div className="ui-stage-row-button">{content}</div>
        : (
          <button
            type="button"
            className="ui-stage-row-button"
            aria-label={`${t('switchTo')} ${stageLabel(entry)}`}
            onClick={() => { onSwitch(entry.name) }}
          >
            {content}
          </button>
        )}
    </li>
  )
}

/** Render the stage tab body. */
export function StageBody({
  useStage,
  switchStage,
  useProjection,
  useSession,
  t,
}: StageBodyProps) {
  const folded = useStage(state => state)
  const wire = useStageWire(useProjection)
  const context = useContextPressure(useProjection)
  const running = useSession(state => state.running)
  const hasMore = useSession(state => state.hasMore)
  const presentation = useMemo(() => presentStages(wire, folded), [wire, folded])

  const [now, setNow] = useState(() => Date.now())
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [pendingStage, setPendingStage] = useState<string | undefined>(undefined)
  const [requestedStage, setRequestedStage] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<StageSwitchOutcome | undefined>(undefined)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const mac = useMemo(() => isMacPlatform(), [])

  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [])

  // A successful request parks until the durable record lands; once the
  // current stage becomes the requested one, the hero's "requested" note is
  // no longer true and clears itself.
  useEffect(() => {
    if (requestedStage !== undefined && presentation.current === requestedStage) {
      setRequestedStage(undefined)
    }
  }, [presentation.current, requestedStage])

  const current = presentation.current
  const currentEntry = presentation.segments.find(segment => segment.live)
  const elapsed = currentEntry?.time === undefined ? undefined : Math.max(0, now - currentEntry.time)
  const currentIndex = presentation.catalog.findIndex(entry => entry.name === current)
  const ringIndex = currentIndex >= 0
    ? currentIndex + 1
    : presentation.segments.length
  const ringTotal = presentation.catalog.length > 0 ? presentation.catalog.length : undefined
  const brief = presentation.catalog.find(entry => entry.name === current)?.instruction
    ?? currentEntry?.instruction
  const contextPct = contextPercent(
    context?.projectedTokens ?? context?.pressureTokens,
    context?.contextWindow,
  )
  const visitedBefore = new Set(presentation.segments.slice(0, -1).map(segment => segment.stage))
  const keycap = mac ? '⌘K' : 'Ctrl K'

  const closePalette = (): void => {
    setPaletteOpen(false)
    triggerRef.current?.focus()
  }

  const requestSwitch = (stage: string): void => {
    if (stage === current || pendingStage !== undefined) return
    setPendingStage(stage)
    setFailure(undefined)
    setRequestedStage(undefined)
    void switchStage(stage).then((outcome) => {
      setPendingStage(undefined)
      if (outcome.ok) setRequestedStage(stage)
      else setFailure(outcome)
    })
  }

  const openPalette = (): void => { setPaletteOpen(true) }

  const onRootKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (paletteOpen) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      openPalette()
    }
  }

  if (current === undefined) {
    return (
      <section
        className="ui-stage-root ui-stage-empty"
        data-stage-tab=""
        data-stage-empty=""
        tabIndex={-1}
        onKeyDown={onRootKeyDown}
      >
        <span className="ui-stage-empty-ring" aria-hidden="true" />
        <p className="ui-stage-empty-title">{t('emptyTitle')}</p>
        <p className="ui-stage-empty-hint">{t('emptyHint')}</p>
        <button type="button" className="ui-stage-empty-action" onClick={openPalette}>
          <CompassGlyph />
          {t('switchStage')}
        </button>
        <StagePalette
          open={paletteOpen}
          current={current}
          catalog={presentation.catalog}
          segments={presentation.segments}
          pending={pendingStage !== undefined}
          onClose={closePalette}
          onPick={requestSwitch}
          t={t}
        />
      </section>
    )
  }

  // Past the empty-state guard the current stage exists, so its label does too.
  const currentLabel = presentation.currentLabel ?? current
  // A queued switch is named by its display label when the catalog carries
  // one; the durable name stays the switch target.
  const requestedLabel = requestedStage === undefined
    ? undefined
    : presentation.catalog.find(entry => entry.name === requestedStage)?.alias ?? requestedStage
  return (
    <section
      className="ui-stage-root"
      data-stage-tab=""
      tabIndex={-1}
      onKeyDown={onRootKeyDown}
    >
      <div className="ui-stage-hero" data-stage-hero="">
        <div className="ui-stage-hero-top">
          <span className="ui-stage-eyebrow">{t('current')}</span>
          <span className="ui-stage-spacer" />
          <span className={`ui-stage-live${running ? '' : ' ui-stage-live--idle'}`}>
            <span className="ui-stage-live-dot" aria-hidden="true" />
            {running ? t('live') : t('idle')}
          </span>
        </div>
        <div className="ui-stage-hero-main">
          <div className="ui-stage-ring" aria-hidden="true">
            <div className="ui-stage-ring-aura" />
            <div className="ui-stage-ring-spin" />
            <div className="ui-stage-ring-track" />
            <div className="ui-stage-ring-orbit" />
            <div className="ui-stage-ring-inner">
              <span className="ui-stage-ring-index">{String(ringIndex).padStart(2, '0')}</span>
              {ringTotal !== undefined && (
                <span className="ui-stage-ring-total">/ {String(ringTotal).padStart(2, '0')}</span>
              )}
            </div>
          </div>
          <div className="ui-stage-copy">
            <h1
              className={`ui-stage-name${currentLabel.length > 12 ? ' ui-stage-name--long' : ''}`}
              data-stage-current=""
              data-stage-name={current}
              title={currentLabel === current ? undefined : current}
              aria-live="polite"
            >
              {currentLabel}
            </h1>
            {brief !== undefined && brief !== '' && (
              <p className="ui-stage-brief" title={brief}>{brief}</p>
            )}
          </div>
        </div>
        {presentation.catalog.length > 0 && (
          <div className="ui-stage-rail" aria-hidden="true">
            {presentation.catalog.map(entry => (
              <span
                key={entry.name}
                className={[
                  'ui-stage-seg',
                  entry.name === current ? 'ui-stage-seg--now' : '',
                  visitedBefore.has(entry.name) ? 'ui-stage-seg--done' : '',
                ].filter(Boolean).join(' ')}
              />
            ))}
          </div>
        )}
        <div className="ui-stage-hero-foot">
          <span className="ui-stage-clock"><ClockGlyph /></span>
          {elapsed === undefined
            ? <span className="ui-stage-in-stage">{t('notStarted')}</span>
            : (
              <span className="ui-stage-in-stage">
                <b>{formatDuration(elapsed)}</b> {t('inStage')}
              </span>
            )}
          {requestedStage !== undefined && requestedStage !== current && (
            <span className="ui-stage-requested" role="status">
              {t('requested', { stage: requestedLabel ?? requestedStage })}
            </span>
          )}
          <span className="ui-stage-spacer" />
          {contextPct !== undefined && (
            <span className="ui-stage-ctx">
              <span className="ui-stage-ctx-label">{t('contextShort')}</span>
              <span className="ui-stage-ctx-track">
                <span
                  className="ui-stage-ctx-fill"
                  style={{
                    width: `${String(contextPct)}%`,
                    ...contextPct >= 85 ? { background: 'var(--dsw-alias-state-error-primary)' }
                      : contextPct >= 60 ? { background: 'var(--dsw-alias-state-warn-primary)' }
                        : {},
                  }}
                />
              </span>
              <span className="ui-stage-ctx-value">{String(contextPct)}%</span>
            </span>
          )}
        </div>
      </div>

      <div className="ui-stage-metrics">
        <div className="ui-stage-metric">
          <span className="ui-stage-metric-value">{String(currentEntry?.messages ?? 0)}</span>
          <span className="ui-stage-metric-label">{t('messages')}</span>
        </div>
        <div className="ui-stage-metric">
          <span className="ui-stage-metric-value">{String(currentEntry?.tools ?? 0)}</span>
          <span className="ui-stage-metric-label">{t('tools')}</span>
        </div>
        <div className="ui-stage-metric">
          <span className="ui-stage-metric-value">{formatTokens(currentEntry?.tokens ?? 0)}</span>
          <span className="ui-stage-metric-label">{t('tokens')}</span>
        </div>
      </div>

      <div className="ui-stage-section">
        <span className="ui-stage-section-label">{t('journey')}</span>
        <span className="ui-stage-spacer" />
        <span className="ui-stage-section-count">
          {presentation.source === 'projection' && presentation.catalog.length > 0
            ? `${String(presentation.segments.length)} / ${String(presentation.catalog.length)}`
            : t('visitedCount', { count: presentation.segments.length })}
        </span>
      </div>
      {(presentation.historyTruncated || (presentation.source === 'fold' && hasMore)) && (
        <p className="ui-stage-note">
          {presentation.historyTruncated ? t('historyTruncated') : t('historyPartial')}
        </p>
      )}
      <ol className="ui-stage-journey" data-stage-history="">
        {presentation.segments.length + presentation.future.length > 1 && (
          <span className="ui-stage-spine" aria-hidden="true" />
        )}
        {presentation.segments.map(segment => (
          <JourneyRow
            key={`${segment.stage}:${String(segment.seq)}`}
            segment={segment}
            catalog={presentation.catalog}
            segments={presentation.segments}
            now={now}
            pending={pendingStage !== undefined}
            onSwitch={requestSwitch}
            t={t}
          />
        ))}
        {presentation.future.map(entry => (
          <FutureRow
            key={`future:${entry.name}`}
            entry={entry}
            catalog={presentation.catalog}
            pending={pendingStage !== undefined}
            onSwitch={requestSwitch}
            t={t}
          />
        ))}
      </ol>

      {failure !== undefined && !failure.ok && (
        <p className="ui-stage-failure" data-stage-failure="" role="alert">
          <span>{t(failure.reason === 'unavailable' ? 'switchUnavailable' : 'switchFailed')}</span>
          {failure.reason === 'failed' && failure.message !== '' && (
            <span className="ui-stage-failure-message">— {failure.message}</span>
          )}
        </p>
      )}

      <button
        ref={triggerRef}
        type="button"
        className="ui-stage-switch"
        data-stage-switch=""
        aria-haspopup="dialog"
        aria-expanded={paletteOpen}
        disabled={pendingStage !== undefined}
        onClick={openPalette}
      >
        <span className="ui-stage-switch-glyph"><SwitchGlyph /></span>
        <span>{t('switchStage')}</span>
        <span className="ui-stage-spacer" />
        <span className="ui-stage-kbd">{keycap}</span>
      </button>

      <StagePalette
        open={paletteOpen}
        current={current}
        catalog={presentation.catalog}
        segments={presentation.segments}
        pending={pendingStage !== undefined}
        onClose={closePalette}
        onPick={requestSwitch}
        t={t}
      />
    </section>
  )
}
