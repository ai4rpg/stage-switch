/**
 * What the stage tab draws: the current stage, then the transition history.
 *
 * The panel supplies the conversation's ground colour and content font
 * sizes, so plain semantic elements inherit the host theme; no stylesheet of
 * its own.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { StageView } from './store.ts'

/** Props supplied to the stage tab body. */
export interface StageBodyProps
  extends PropsRuntime<'sidebar.right.pane.tab'>, PropsLocale<'sidebarStage'> {
  /** Stage view selector injected by this package's registration. */
  readonly useStage: SnapshotSelectorHook<StageView>
}

/** Render the stage tab body. */
export function StageBody({ useStage, t }: StageBodyProps) {
  const view = useStage(state => state)
  const records = view.records
  if (records.length === 0) {
    return <p data-stage-empty="">{t('empty')}</p>
  }
  const last = records[records.length - 1]
  if (last === undefined) throw new Error('ui-sidebar-stage: non-empty records lost their last entry')
  return (
    <section data-stage-tab="">
      <h2>{t('current')}</h2>
      <p data-stage-current="">{last.stage}</p>
      <h2>{t('history')}</h2>
      <ol data-stage-history="">
        {records.map(record => (
          <li key={record.seq}>
            {t(record.switched ? 'switched' : 'entered')}{' '}{record.stage}
          </li>
        ))}
      </ol>
    </section>
  )
}
