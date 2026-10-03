/**
 * What the stage tab draws: the current stage as a switch dropdown, then the
 * transition history.
 *
 * The current stage IS the control: the capsule from the pane's official
 * visual language rendered as the {@link StageSelect} dropdown whose value
 * is the folded current stage and whose options are the stages this session
 * has recorded. Picking a stage submits `/stage <name>` through the session's
 * command face (the registration's inject face carries the action); the
 * durable record the switch appends re-renders the tab through the fold, and
 * a queued switch (issued during an open turn) honestly parks the value back
 * on the stage still in force until the boundary flush lands.
 *
 * The dropdown offers only the stages this session has recorded — the stage
 * catalog is preset-owned Host data with no client channel, so the tab never
 * guesses it. Every colour rides a `--dsw-alias-*` token, so light and dark
 * themes both resolve without an override. Styles are inline because the
 * closure bundle has no CSS pipeline; the values are layout constants, not
 * theme tokens. The panel supplies the ground colour and content font sizes.
 */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { StageView } from './store.ts'
import type { StageRecord } from './fold.ts'
import type { StageSwitchOutcome } from './switch.ts'
import { StageSelect } from './StageSelect.tsx'

/** Props supplied to the stage tab body. */
export interface StageBodyProps
  extends PropsRuntime<'sidebar.right.pane.tab'>, PropsLocale<'sidebarStage'> {
  /** Stage view selector injected by this package's registration. */
  readonly useStage: SnapshotSelectorHook<StageView>
  /** Switch action injected by this package's registration. */
  readonly switchStage: (stage: string) => Promise<StageSwitchOutcome>
}

/** The pane's scroller insets nothing, so the body keeps its own gutter. */
const BODY_PADDING = '16px 16px 24px'

/** A quiet section label, the review tab's 12px tertiary line. */
const SECTION_LABEL = {
  margin: 0,
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: '12px',
  fontWeight: 400,
  lineHeight: '18px',
} as const

/** One history row's verb, on the quietest ink. */
const ROW_VERB = {
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: '12px',
  lineHeight: '18px',
} as const

/** The switch failure line, on the error ink. */
const FAILURE_LINE = {
  margin: 0,
  color: 'var(--dsw-alias-state-error-primary)',
  fontSize: '12px',
  lineHeight: '18px',
} as const

/** One history row's status dot; the live record rides the business accent. */
function dotStyle(live: boolean) {
  return {
    flex: 'none',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: live
      ? 'var(--dsw-alias-state-business-primary)'
      : 'var(--dsw-alias-border-l3)',
  } as const
}

/** One history row's stage name; the live record is the emphasized line. */
function nameStyle(live: boolean) {
  return {
    color: live ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
    fontSize: '13px',
    fontWeight: live ? 500 : 400,
    lineHeight: '20px',
    overflowWrap: 'anywhere',
  } as const
}

/** The distinct stage names a session has recorded, in first-record order. */
function visitedStages(records: readonly StageRecord[]): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const record of records) {
    if (seen.has(record.stage)) continue
    seen.add(record.stage)
    names.push(record.stage)
  }
  return names
}

/** Render the stage tab body. */
export function StageBody({ useStage, switchStage, t }: StageBodyProps) {
  const view = useStage(state => state)
  const records = view.records
  const [pendingStage, setPendingStage] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<StageSwitchOutcome | undefined>(undefined)
  if (records.length === 0) {
    return (
      <div style={{
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100%',
        padding: '0 24px',
      }}>
        <p data-stage-empty="" style={{
          margin: 0,
          color: 'var(--dsw-alias-label-tertiary)',
          fontSize: '13px',
          lineHeight: '20px',
          textAlign: 'center',
        }}>{t('empty')}</p>
      </div>
    )
  }
  const last = records[records.length - 1]
  if (last === undefined) throw new Error('ui-sidebar-stage: non-empty records lost their last entry')
  const current = last.stage
  const visited = visitedStages(records)
  return (
    <section data-stage-tab="" style={{
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      padding: BODY_PADDING,
    }}>
      <h2 style={SECTION_LABEL}>{t('current')}</h2>
      <StageSelect
        current={current}
        visited={visited}
        pending={pendingStage !== undefined}
        ariaLabel={t('switchTo')}
        onPick={(stage) => {
          setPendingStage(stage)
          setFailure(undefined)
          void switchStage(stage).then(outcome => {
            // Clear the pick either way: on success the folded current takes
            // over (immediately for an idle commit; at the boundary flush for
            // a queued switch, whose stage is honestly still the old one
            // until then), and on failure the value parks back on the stage
            // in force.
            setPendingStage(undefined)
            if (!outcome.ok) setFailure(outcome)
          })
        }}
      />
      {failure !== undefined && !failure.ok && (
        <p data-stage-failure="" style={FAILURE_LINE}>
          {t(failure.reason === 'unavailable' ? 'switchUnavailable' : 'switchFailed')}
        </p>
      )}
      <h2 style={{ ...SECTION_LABEL, marginTop: '12px' }}>{t('history')}</h2>
      <ol data-stage-history="" style={{
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {records.map((record, index) => {
          const live = index === records.length - 1
          return (
            <li key={record.seq} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '7px 2px',
            }}>
              <span aria-hidden="true" style={dotStyle(live)} />
              <span style={ROW_VERB}>{t(record.switched ? 'switched' : 'entered')}{' '}</span>
              <span style={nameStyle(live)}>{record.stage}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
