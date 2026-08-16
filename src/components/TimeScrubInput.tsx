import { useRef } from 'react'
import {
  fromLocalTimeValue,
  stepLocalTime,
  toLocalTimeValue,
  type ClockTimeField,
} from '../lib/tasks'

const SCRUB_PX = 25
const SCRUB_ACTIVATE_PX = 8

function readSelectionStart(input: HTMLInputElement): number | null {
  try {
    return input.selectionStart
  } catch {
    return null
  }
}

/** Value shape: HH:mm */
function fieldFromSelection(start: number | null): ClockTimeField {
  if (start == null) return 'minute'
  if (start <= 2) return 'hour'
  return 'minute'
}

/** Build a local ISO for today at `HH:mm` (for stepping). */
function hhmmToIso(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  const hours = m ? Number(m[1]) : 9
  const minutes = m ? Number(m[2]) : 0
  const d = new Date()
  d.setHours(
    Number.isFinite(hours) ? hours : 9,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0,
  )
  return d.toISOString()
}

type TimeScrubInputProps = {
  /** Local wall-clock time as `HH:mm`. */
  value: string
  onChange: (hhmm: string) => void
  stepMinutes?: number
  disabled?: boolean
  id?: string
  className?: string
  'aria-label'?: string
}

/**
 * Native `type="time"` with the same vertical scrub + arrow-key stepping
 * used on plan anchors.
 */
export function TimeScrubInput({
  value,
  onChange,
  stepMinutes = 5,
  disabled,
  id,
  className,
  'aria-label': ariaLabel,
}: TimeScrubInputProps) {
  const pointerActiveRef = useRef(false)
  const valueRef = useRef(value)
  valueRef.current = value
  const step = Math.max(1, Math.round(stepMinutes) || 5)

  function beginScrub(e: React.PointerEvent<HTMLInputElement>) {
    if (e.button !== 0 || disabled) return
    const input = e.currentTarget
    const startY = e.clientY
    const startX = e.clientX
    const pointerId = e.pointerId
    let active = false
    let lastTick = 0
    let field: ClockTimeField = 'minute'
    const originIso = hhmmToIso(valueRef.current)
    pointerActiveRef.current = true
    window.getSelection()?.removeAllRanges()

    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!active) {
        if (Math.abs(dy) < SCRUB_ACTIVATE_PX) return
        if (Math.abs(dy) < Math.abs(dx)) {
          cleanup()
          return
        }
        active = true
        field = fieldFromSelection(readSelectionStart(input))
        document.body.classList.add('is-datetime-scrubbing')
        window.getSelection()?.removeAllRanges()
        input.blur()
        try {
          input.setPointerCapture(pointerId)
        } catch {
          /* ignore */
        }
      }
      ev.preventDefault()
      window.getSelection()?.removeAllRanges()
      const tick = Math.trunc(-dy / SCRUB_PX)
      if (tick === lastTick) return
      lastTick = tick
      onChange(toLocalTimeValue(stepLocalTime(originIso, field, tick, step)))
    }

    function cleanup() {
      pointerActiveRef.current = false
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('is-datetime-scrubbing')
      try {
        if (input.hasPointerCapture(pointerId)) {
          input.releasePointerCapture(pointerId)
        }
      } catch {
        /* ignore */
      }
    }

    function onUp(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return
      cleanup()
    }

    document.addEventListener('pointermove', onMove, { passive: false })
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
  }

  function applyChange(next: string) {
    if (!next) return
    if (
      pointerActiveRef.current ||
      document.body.classList.contains('is-datetime-scrubbing')
    ) {
      return
    }
    const iso = fromLocalTimeValue(next, hhmmToIso(valueRef.current))
    onChange(toLocalTimeValue(iso) || next)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const field = fieldFromSelection(readSelectionStart(e.currentTarget))
    const steps = e.key === 'ArrowUp' ? 1 : -1
    const base = hhmmToIso(valueRef.current)
    onChange(toLocalTimeValue(stepLocalTime(base, field, steps, step)))
  }

  return (
    <input
      id={id}
      type="time"
      className={className}
      step={step * 60}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => applyChange(e.target.value)}
      onKeyDown={handleKeyDown}
      onPointerDown={beginScrub}
    />
  )
}
