/**
 * The tab chip's live title: the current stage name with its identity dot.
 *
 * The value comes from the Host `stage` wire view; on a host without it the
 * title falls back to the tab type's label, so an old composition loses the
 * live name but keeps a correctly labelled tab.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useStageWire } from './wire.ts'
import { stageAccent } from './format.ts'
import { stageLabel } from './present.ts'

/** Render the live stage title. */
export function StageTitle({
  useProjection,
  t,
}: PropsRuntime<'sidebar.right.pane.tab.title'> & PropsLocale<'sidebarStage'>) {
  const wire = useStageWire(useProjection)
  if (wire === undefined) return <span className="ui-stage-title">{t('type.label')}</span>
  const stage = wire.stage
  const entry = wire.stages.find(candidate => candidate.name === stage)
  // The chip shows the alias when configured; the tooltip keeps the durable
  // name so the real switch target stays discoverable.
  return (
    <span className="ui-stage-title" title={`${t('type.label')}: ${stage}`}>
      <span
        className="ui-stage-title-dot"
        aria-hidden="true"
        style={{ background: stageAccent(stage, wire.stages) }}
      />
      <span className="ui-stage-title-name">{entry === undefined ? stage : stageLabel(entry)}</span>
    </span>
  )
}
