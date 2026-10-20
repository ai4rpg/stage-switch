/**
 * The command palette that replaces the old stage capsule dropdown.
 *
 * It lists the configured catalog when the host `stage` wire view is present,
 * or the visited stages in the fold fallback, and always accepts a custom
 * stage name matching the host grammar. The current stage is marked and inert;
 * every other row submits the same `/stage <name>` command the chat input
 * runs. Keyboard: arrows move the highlight, Enter switches, Escape closes,
 * and the input keeps focus while the palette is open.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { StageCatalogEntry, StageSegment } from './present.ts'
import { formatClock, formatDuration, stageAccent } from './format.ts'
import { stageLabel } from './present.ts'

/** Props supplied by the stage tab body. */
export interface StagePaletteProps {
  /** Whether the palette is open. */
  readonly open: boolean
  /** The stage in force. */
  readonly current: string | undefined
  /** The configured catalog, or the visited subset in the fold fallback. */
  readonly catalog: readonly StageCatalogEntry[]
  /** Recorded visits, used for the visited fallback and per-row metadata. */
  readonly segments: readonly StageSegment[]
  /** Whether a switch command is in flight. */
  readonly pending: boolean
  /** Close the palette without switching. */
  readonly onClose: () => void
  /** Submit one picked stage. */
  readonly onPick: (stage: string) => void
}

/** The host's stage-name grammar; mirrors the command's validation. */
const STAGE_NAME = /^[a-z][a-z0-9_-]*$/

/** One palette row: a catalog stage or a typed custom stage. */
type PaletteRow =
  | { readonly kind: 'stage'; readonly entry: StageCatalogEntry }
  | { readonly kind: 'custom'; readonly stage: string }

/** The distinct visited stages in first-record order, for the fallback catalog. */
function visitedCatalog(segments: readonly StageSegment[]): StageCatalogEntry[] {
  const seen = new Set<string>()
  const catalog: StageCatalogEntry[] = []
  for (const segment of segments) {
    if (seen.has(segment.stage)) continue
    seen.add(segment.stage)
    catalog.push({ name: segment.stage, instruction: segment.instruction ?? '' })
  }
  return catalog
}

/** The latest visit of one stage. */
function latestVisit(segments: readonly StageSegment[], stage: string): StageSegment | undefined {
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index]
    if (segment?.stage === stage) return segment
  }
  return undefined
}

/** The duration of a visit, ended by the next visit or the current clock. */
function visitDuration(segments: readonly StageSegment[], segment: StageSegment, now: number): string | undefined {
  if (segment.time === undefined) return undefined
  const index = segments.indexOf(segment)
  const next = index >= 0 ? segments[index + 1] : undefined
  return formatDuration(next?.time === undefined ? now - segment.time : next.time - segment.time)
}

/** Search glyph. */
function SearchGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="m10.4 10.4 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** Enter glyph on the highlighted row. */
function EnterGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8h9M8.6 4.6 12 8l-3.4 3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Render the switch palette. */
export function StagePalette({
  open,
  current,
  catalog,
  segments,
  pending,
  onClose,
  onPick,
  t,
}: StagePaletteProps & { readonly t: TranslateNS<'sidebarStage'> }) {
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const options = catalog.length > 0 ? catalog : visitedCatalog(segments)
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = options.filter(option => option.name.includes(normalizedQuery)
    || (option.alias?.toLowerCase().includes(normalizedQuery) ?? false))
  const custom = normalizedQuery !== ''
    && STAGE_NAME.test(normalizedQuery)
    && !options.some(option => option.name === normalizedQuery || option.alias?.toLowerCase() === normalizedQuery)
    ? normalizedQuery
    : undefined
  const rows: PaletteRow[] = useMemo(() => [
    ...filtered.map(entry => ({ kind: 'stage' as const, entry })),
    ...custom === undefined ? [] : [{ kind: 'custom' as const, stage: custom }],
  ], [filtered, custom])

  // Reset on open and keep the input focused; the palette owns focus while it
  // is open, so Escape returns to the trigger through the body's cleanup.
  useEffect(() => {
    if (!open) return
    // Start on the first actionable row: the current stage is inert, so
    // highlighting it would make Enter a no-op. Typing or arrowing moves the
    // highlight from there.
    const list = catalog.length > 0 ? catalog : visitedCatalog(segments)
    const index = list.findIndex(option => option.name !== current)
    setQuery('')
    setHighlighted(index >= 0 ? index : 0)
    inputRef.current?.focus()
  }, [open])

  useEffect(() => { setHighlighted(0) }, [query])

  useEffect(() => {
    if (highlighted >= rows.length) setHighlighted(Math.max(0, rows.length - 1))
  }, [highlighted, rows.length])

  if (!open) return null

  const choose = (row: PaletteRow | undefined): void => {
    if (row === undefined || pending) return
    if (row.kind === 'stage' && row.entry.name === current) { onClose(); return }
    onPick(row.kind === 'stage' ? row.entry.name : row.stage)
    onClose()
  }

  const onPaletteKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (rows.length === 0) return
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setHighlighted(index => (index + direction + rows.length) % rows.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(rows[highlighted])
      return
    }
    // Keep focus inside the dialog; the input owns the active row.
    if (event.key === 'Tab') event.preventDefault()
  }

  const metaOf = (entry: StageCatalogEntry): string => {
    if (entry.name === current) return t('now')
    const visit = latestVisit(segments, entry.name)
    if (visit === undefined) return t('notVisited')
    if (visit.time === undefined) return t('notVisited')
    const duration = visitDuration(segments, visit, Date.now())
    return duration === undefined ? formatClock(visit.time) : `${formatClock(visit.time)} · ${duration}`
  }

  return (
    <div
      className="ui-stage-palette-wrap"
      data-stage-menu=""
      role="dialog"
      aria-modal="true"
      aria-label={t('switchTo')}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="ui-stage-palette" onKeyDown={onPaletteKeyDown}>
        <div className="ui-stage-search">
          <span className="ui-stage-search-icon"><SearchGlyph /></span>
          <input
            ref={inputRef}
            className="ui-stage-search-input"
            type="text"
            value={query}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
            onChange={(event) => { setQuery(event.target.value) }}
          />
        </div>
        <div className="ui-stage-palette-group">
          <div className="ui-stage-palette-label">{t('route')}</div>
          {rows.length === 0 && (
            <p className="ui-stage-note" style={{ padding: '4px 8px 8px' }}>{t('noMatches')}</p>
          )}
          {rows.map((row, index) => {
            const name = row.kind === 'stage' ? row.entry.name : row.stage
            const label = row.kind === 'stage' ? stageLabel(row.entry) : row.stage
            const aliased = row.kind === 'stage' && row.entry.alias !== undefined && row.entry.alias !== name
            const color = stageAccent(name, options)
            const selected = index === highlighted
            const disabled = pending || (row.kind === 'stage' && name === current)
            return (
              <button
                key={`${row.kind}:${name}`}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={disabled || undefined}
                data-stage-option={name}
                className={[
                  'ui-stage-option',
                  selected ? 'ui-stage-option--selected' : '',
                  disabled ? 'ui-stage-option--disabled' : '',
                ].filter(Boolean).join(' ')}
                style={{ '--ui-stage-option-color': color } as CSSProperties}
                onMouseEnter={() => { setHighlighted(index) }}
                onClick={() => { choose(row) }}
              >
                <span className="ui-stage-option-dot" aria-hidden="true" />
                <span className="ui-stage-option-name">{label}</span>
                {aliased && <span className="ui-stage-option-hint">{name}</span>}
                <span className="ui-stage-option-meta">
                  {row.kind === 'custom' ? t('custom') : metaOf(row.entry)}
                </span>
                {selected && <span className="ui-stage-option-enter"><EnterGlyph /></span>}
              </button>
            )
          })}
        </div>
        <div className="ui-stage-palette-foot">
          <span><b>↑↓</b> {t('hintNavigate')}</span>
          <span><b>↵</b> {t('hintSwitch')}</span>
          <span><b>esc</b> {t('hintClose')}</span>
          <span className="ui-stage-spacer" />
          <span>{t('typeAny')}</span>
        </div>
      </div>
    </div>
  )
}
