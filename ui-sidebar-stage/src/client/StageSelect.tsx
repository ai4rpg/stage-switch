/**
 * The current-stage dropdown: the capsule trigger plus its listbox.
 *
 * Hand-rolled against the pane's official menu language (the primitives
 * `Menu`/`MenuSurface` shapes) because the primitives package's 0.2.0 line is
 * not installable for types from an external repo — the styling copies its
 * tokens instead: the surface fill with backdrop blur on the lg radius, the
 * 4px anchor gap, 4px card padding, md-radius rows with the hover fill, and
 * the trailing check on the selected row. The trigger is the stage tab's
 * capsule (bg-layer-1, l3 hairline, xl radius) with an 18px chevron that
 * flips while open.
 *
 * Keyboard: the trigger toggles on click/Enter/Space and opens on the arrow
 * keys; Tab reaches the rows (real buttons), the arrows walk them, Enter
 * activates the focused row, and Escape closes and returns focus to the
 * trigger. A pointerdown outside closes the list.
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'

/** Props supplied by the stage tab body. */
export interface StageSelectProps {
  /** The stage in force — the trigger's text and the selected row. */
  readonly current: string
  /** The distinct stages the session has recorded, in first-record order. */
  readonly visited: readonly string[]
  /** Whether a switch is in flight (locks the trigger). */
  readonly pending: boolean
  /** Accessible name for the control. */
  readonly ariaLabel: string
  /** Submit one picked stage (never called for the stage already in force). */
  readonly onPick: (stage: string) => void
}

/** The capsule trigger, the guide entry's non-interactive shape as a button. */
const TRIGGER_BASE: CSSProperties = {
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
  margin: 0,
  padding: '12px 16px',
  border: '0.5px solid var(--dsw-alias-border-l3)',
  borderRadius: 'var(--dsw-radius-xl)',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: '14px',
  fontWeight: 500,
  lineHeight: '22px',
  textAlign: 'left',
  cursor: 'pointer',
}

/** The trigger's stage name; long names ellipsize inside the capsule. */
const TRIGGER_LABEL: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** The dropdown card, the official menu surface on the lg radius. */
const LIST: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  right: 0,
  zIndex: 100,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  padding: '4px',
  border: 0,
  borderRadius: 'var(--dsw-radius-lg)',
  background: 'var(--dsw-menu-surface-fill)',
  backdropFilter: 'var(--dsw-menu-backdrop-filter)',
  boxShadow: 'var(--dsw-elevation-prominent)',
}

/** One option row, the official menu cell. */
const ROW_BASE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  width: '100%',
  minHeight: '34px',
  padding: '6px 8px',
  border: 'none',
  borderRadius: 'var(--dsw-radius-md)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: '13px',
  lineHeight: '20px',
  textAlign: 'left',
  cursor: 'pointer',
}

/** The row's stage name. */
const ROW_LABEL: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** The trigger's chevron, flipping while the list is open. */
function ChevronGlyph({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" style={{
      flex: 'none',
      color: 'var(--dsw-alias-label-secondary)',
      transform: open ? 'rotate(180deg)' : 'none',
      transition: 'transform 150ms ease',
    }}>
      <path d="M4 6.5 9 11.5 14 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The selected row's trailing check, the official menu marker. */
function CheckGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{
      flex: 'none',
      color: 'var(--dsw-alias-label-primary)',
    }}>
      <path d="M2.5 7.5 5.5 10.5 11.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Render the current-stage dropdown. */
export function StageSelect({ current, visited, pending, ariaLabel, onPick }: StageSelectProps) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Outside pointerdown and Escape close the list; Escape returns the
  // keyboard to the trigger.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) !== true) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // The arrows walk the rows with real focus, so the keyboard's row carries
  // the same fill the pointer gets.
  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const rows = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]
    if (rows.length === 0) return
    const index = rows.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown'
      ? (index + 1) % rows.length
      : (index - 1 + rows.length) % rows.length
    rows[next]?.focus()
  }

  const close = (): void => { setOpen(false) }

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <button
        ref={triggerRef}
        type="button"
        data-stage-current=""
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={pending}
        onClick={() => { setOpen(currentOpen => !currentOpen) }}
        onMouseEnter={() => { setHovered(true) }}
        onMouseLeave={() => { setHovered(false) }}
        onFocus={() => { setFocused(true) }}
        onBlur={() => { setFocused(false) }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
        style={{
          ...TRIGGER_BASE,
          // The official trigger keeps the hover fill while expanded.
          background: hovered || open
            ? 'var(--dsw-alias-interactive-bg-hover)'
            : 'var(--dsw-alias-bg-layer-1)',
          outline: focused
            ? 'var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))'
            : 'none',
          outlineOffset: 3,
        }}
      >
        <span style={TRIGGER_LABEL}>{current}</span>
        <ChevronGlyph open={open} />
      </button>
      {open && (
        <div role="listbox" data-stage-menu="" aria-label={ariaLabel} onKeyDown={onListKeyDown} style={LIST}>
          {visited.map(stage => (
            <Row
              key={stage}
              stage={stage}
              selected={stage === current}
              onPick={() => {
                if (stage !== current) onPick(stage)
                close()
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** One option row: the stage name plus the selected marker. */
function Row({ stage, selected, onPick }: { stage: string; selected: boolean; onPick: () => void }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      onMouseEnter={() => { setHovered(true) }}
      onMouseLeave={() => { setHovered(false) }}
      onFocus={() => { setFocused(true) }}
      onBlur={() => { setFocused(false) }}
      style={{
        ...ROW_BASE,
        // The fill is the row's hover and focus indication, the official
        // menu's rule; the browser ring would double it.
        background: hovered || focused ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
        outline: 'none',
      }}
    >
      <span style={ROW_LABEL}>{stage}</span>
      {selected && <CheckGlyph />}
    </button>
  )
}
