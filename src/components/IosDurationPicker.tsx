import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  combineDurationMinutes,
  splitDurationMinutes,
} from '../lib/tasks'

const ITEM_HEIGHT = 40
const VISIBLE_ROWS = 5
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i)
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => i)

function pad2(n: number): string {
  return String(Math.max(0, Math.round(n))).padStart(2, '0')
}

function formatDurationHhMm(totalMinutes: number): string {
  const { hours, minutes } = splitDurationMinutes(totalMinutes)
  return `${pad2(hours)}:${pad2(minutes)}`
}

function DurationWheelColumn({
  options,
  value,
  unit,
  onChange,
}: {
  options: number[]
  value: number
  unit: string
  onChange: (next: number) => void
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const settleTimer = useRef<number | null>(null)
  const suppressScroll = useRef(false)

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const index = Math.max(0, options.indexOf(value))
    suppressScroll.current = true
    el.scrollTop = index * ITEM_HEIGHT
    requestAnimationFrame(() => {
      suppressScroll.current = false
    })
  }, [options, value])

  function settle() {
    const el = scrollerRef.current
    if (!el || suppressScroll.current) return
    const index = Math.round(el.scrollTop / ITEM_HEIGHT)
    const clamped = Math.max(0, Math.min(options.length - 1, index))
    const next = options[clamped] ?? 0
    const target = clamped * ITEM_HEIGHT
    if (Math.abs(el.scrollTop - target) > 0.5) {
      el.scrollTo({ top: target, behavior: 'smooth' })
    }
    if (next !== value) onChange(next)
  }

  function handleScroll() {
    if (suppressScroll.current) return
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(settle, 80)
  }

  useEffect(() => {
    return () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
    }
  }, [])

  const pad = Math.floor(VISIBLE_ROWS / 2)

  return (
    <div className="ios-duration-wheel">
      <div
        ref={scrollerRef}
        className="ios-duration-wheel-scroller"
        onScroll={handleScroll}
        aria-label={unit}
      >
        {Array.from({ length: pad }, (_, i) => (
          <div key={`pad-top-${i}`} className="ios-duration-wheel-item" />
        ))}
        {options.map((option) => (
          <div
            key={option}
            className={[
              'ios-duration-wheel-item',
              option === value ? 'is-selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {option}
          </div>
        ))}
        {Array.from({ length: pad }, (_, i) => (
          <div key={`pad-bottom-${i}`} className="ios-duration-wheel-item" />
        ))}
      </div>
      <span className="ios-duration-wheel-unit muted">{unit}</span>
    </div>
  )
}

export function IosDurationPicker({
  totalMinutes,
  onChange,
}: {
  totalMinutes: number
  onChange: (totalMinutes: number) => void
}) {
  const [open, setOpen] = useState(false)
  const split = splitDurationMinutes(totalMinutes)
  const [draftHours, setDraftHours] = useState(split.hours)
  const [draftMinutes, setDraftMinutes] = useState(split.minutes)
  const openedAt = useRef(split)

  function openPicker() {
    const current = splitDurationMinutes(totalMinutes)
    openedAt.current = current
    setDraftHours(Math.min(23, current.hours))
    setDraftMinutes(current.minutes)
    setOpen(true)
  }

  function applyDraft(h: number, m: number) {
    onChange(combineDurationMinutes(h, m))
  }

  function handleHours(next: number) {
    setDraftHours(next)
    applyDraft(next, draftMinutes)
  }

  function handleMinutes(next: number) {
    setDraftMinutes(next)
    applyDraft(draftHours, next)
  }

  function cancel() {
    applyDraft(openedAt.current.hours, openedAt.current.minutes)
    setOpen(false)
  }

  function done() {
    applyDraft(draftHours, draftMinutes)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      const previous = openedAt.current
      onChange(
        combineDurationMinutes(previous.hours, previous.minutes),
      )
      setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onChange])

  const display = formatDurationHhMm(totalMinutes)

  return (
    <>
      <button
        type="button"
        className="ios-duration-trigger"
        onClick={openPicker}
        aria-label={`Duration ${display}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {display}
      </button>
      {open &&
        createPortal(
          <div
            className="ios-duration-backdrop"
            role="presentation"
            onClick={cancel}
          >
            <div
              className="ios-duration-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Duration"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="ios-duration-toolbar">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={cancel}
                >
                  Cancel
                </button>
                <span className="ios-duration-title">Duration</span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={done}
                >
                  Done
                </button>
              </div>
              <div className="ios-duration-wheels">
                <div className="ios-duration-selection" aria-hidden="true" />
                <DurationWheelColumn
                  options={HOUR_OPTIONS}
                  value={Math.min(23, draftHours)}
                  unit="hours"
                  onChange={handleHours}
                />
                <DurationWheelColumn
                  options={MINUTE_OPTIONS}
                  value={draftMinutes}
                  unit="min"
                  onChange={handleMinutes}
                />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
