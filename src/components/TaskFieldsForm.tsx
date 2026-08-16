import { useEffect, useState } from 'react'
import type { Task } from '../lib/tasks'
import {
  combineDurationMinutes,
  splitDurationMinutes,
  stepDurationMinutes,
} from '../lib/tasks'

const SCRUB_PX = 25
const SCRUB_ACTIVATE_PX = 8

function normalizeDurationFields(
  hours: number | '',
  minutes: number | '',
): { hours: number; minutes: number } {
  let hoursVal = hours === '' ? 0 : Math.max(0, Math.round(hours))
  let minutesVal = minutes === '' ? 0 : Math.max(0, Math.round(minutes))
  if (minutesVal >= 60) {
    hoursVal += Math.floor(minutesVal / 60)
    minutesVal = minutesVal % 60
  }
  return { hours: hoursVal, minutes: minutesVal }
}

function beginVerticalScrub(
  e: React.PointerEvent<HTMLInputElement>,
  applyTick: (tick: number) => void,
) {
  if (e.button !== 0) return
  const input = e.currentTarget
  const startY = e.clientY
  const startX = e.clientX
  const pointerId = e.pointerId
  let active = false
  let lastTick = 0

  function onMove(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return
    const dx = ev.clientX - startX
    const dy = ev.clientY - startY
    if (!active) {
      if (Math.abs(dy) < SCRUB_ACTIVATE_PX) return
      if (Math.abs(dy) < Math.abs(dx)) {
        cleanup(false)
        return
      }
      active = true
      document.body.classList.add('is-datetime-scrubbing')
      input.blur()
      try {
        input.setPointerCapture(pointerId)
      } catch {
        /* ignore */
      }
    }
    ev.preventDefault()
    const tick = Math.trunc(-dy / SCRUB_PX)
    if (tick === lastTick) return
    lastTick = tick
    applyTick(tick)
  }

  function cleanup(focusForTyping: boolean) {
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
    if (focusForTyping) {
      input.focus()
      input.select()
    }
  }

  function onUp(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return
    cleanup(!active)
  }

  document.addEventListener('pointermove', onMove, { passive: false })
  document.addEventListener('pointerup', onUp)
  document.addEventListener('pointercancel', onUp)
}

export function TaskFieldsForm({
  initialTitle,
  initialDuration,
  initialEmpty = false,
  submitLabel,
  busy,
  previewGroupId,
  previewTaskId,
  onTaskEditPreview,
  onSubmit,
  onCancel,
  stepMinutes = 5,
}: {
  initialTitle: string
  initialDuration: number
  initialEmpty?: boolean
  submitLabel: string
  busy?: boolean
  previewGroupId?: string
  previewTaskId?: string
  onTaskEditPreview?: (preview: {
    groupId: string
    taskId: string
    title: string
    durationMinutes: number
    empty?: boolean
  } | null) => void
  onSubmit: (task: Omit<Task, 'id'>) => void
  onCancel: () => void
  /** Scrub / spinner grid in minutes (5 or 15). */
  stepMinutes?: number
}) {
  const step = Math.max(1, Math.round(stepMinutes) || 5)
  const initialSplit = splitDurationMinutes(initialDuration)
  const [title, setTitle] = useState(initialTitle)
  const [hours, setHours] = useState<number | ''>(initialSplit.hours)
  const [minutes, setMinutes] = useState<number | ''>(initialSplit.minutes)
  const [empty, setEmpty] = useState(initialEmpty)

  function resolveTotalMinutes(h: number | '', m: number | ''): number {
    if (h === '' && m === '') return initialDuration
    return combineDurationMinutes(h === '' ? 0 : h, m === '' ? 0 : m)
  }

  useEffect(() => {
    if (!onTaskEditPreview || !previewGroupId || !previewTaskId) return
    onTaskEditPreview({
      groupId: previewGroupId,
      taskId: previewTaskId,
      title: title.trim() || initialTitle,
      durationMinutes: resolveTotalMinutes(hours, minutes),
      ...(empty ? { empty: true } : {}),
    })
  }, [
    title,
    hours,
    minutes,
    empty,
    previewGroupId,
    previewTaskId,
    onTaskEditPreview,
    initialTitle,
    initialDuration,
  ])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  function setTotalDuration(total: number) {
    const split = splitDurationMinutes(total)
    setHours(split.hours)
    setMinutes(split.minutes)
  }

  function commitDurationBlur() {
    if (hours === '' && minutes === '') {
      setTotalDuration(initialDuration)
      return
    }
    const normalized = normalizeDurationFields(hours, minutes)
    setHours(normalized.hours)
    setMinutes(normalized.minutes)
  }

  function handleHoursChange(raw: string) {
    if (raw === '') {
      setHours('')
      return
    }
    const next = Number(raw)
    if (!Number.isFinite(next)) return
    const prev = typeof hours === 'number' ? hours : 0
    const delta = next - prev
    if (Math.abs(delta) === 1) {
      setHours(Math.max(0, prev + delta))
      return
    }
    setHours(Math.max(0, Math.round(next)))
  }

  function handleMinutesChange(raw: string) {
    if (raw === '') {
      setMinutes('')
      return
    }
    const next = Number(raw)
    if (!Number.isFinite(next)) return
    const prev = typeof minutes === 'number' ? minutes : 0
    const hoursVal = hours === '' ? 0 : hours
    const delta = next - prev
    if (next !== prev) {
      const isSpinner =
        Math.abs(delta) === 1 ||
        (Math.abs(delta) === step && prev % step !== 0)
      if (isSpinner) {
        const prevTotal = combineDurationMinutes(hoursVal, prev)
        const nextTotal = combineDurationMinutes(hoursVal, next)
        setTotalDuration(
          stepDurationMinutes(
            prevTotal,
            nextTotal > prevTotal ? 'up' : 'down',
            step,
          ),
        )
        return
      }
    }
    setMinutes(Math.max(0, Math.round(next)))
  }

  function beginHoursScrub(e: React.PointerEvent<HTMLInputElement>) {
    const originHours = typeof hours === 'number' ? hours : 0
    const originMinutes = typeof minutes === 'number' ? minutes : 0
    beginVerticalScrub(e, (tick) => {
      setTotalDuration(
        combineDurationMinutes(Math.max(0, originHours + tick), originMinutes),
      )
    })
  }

  function beginMinutesScrub(e: React.PointerEvent<HTMLInputElement>) {
    const origin = resolveTotalMinutes(hours, minutes)
    beginVerticalScrub(e, (tick) => {
      if (tick === 0) {
        setTotalDuration(origin)
        return
      }
      if (tick > 0) {
        const floor = Math.floor(origin / step) * step
        setTotalDuration(Math.max(1, floor + tick * step))
        return
      }
      const ceil = Math.ceil(origin / step) * step
      setTotalDuration(Math.max(1, ceil + tick * step))
    })
  }

  function nudgeTotalDuration(direction: 'up' | 'down') {
    setTotalDuration(
      stepDurationMinutes(resolveTotalMinutes(hours, minutes), direction, step),
    )
  }

  function nudgeHours(direction: 'up' | 'down') {
    const current = typeof hours === 'number' ? hours : 0
    if (direction === 'up') {
      setHours(current + 1)
      return
    }
    setHours(Math.max(0, current - 1))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    const normalized = normalizeDurationFields(hours, minutes)
    onSubmit({
      title: title.trim(),
      durationMinutes: combineDurationMinutes(
        normalized.hours,
        normalized.minutes,
      ),
      ...(empty ? { empty: true } : {}),
    })
  }

  return (
    <form className="task-form" onSubmit={handleSubmit} noValidate>
      <input
        className="task-form-name"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Event Name"
        aria-label="Event name"
        required
        autoFocus
      />
      <div className="task-form-row">
        <div className="task-form-duration">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={hours}
            onChange={(e) => handleHoursChange(e.target.value)}
            onBlur={commitDurationBlur}
            onPointerDown={beginHoursScrub}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                nudgeHours('up')
                return
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                nudgeHours('down')
                return
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            aria-label="Duration hours"
          />
          <span className="muted">h</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={step}
            className="task-form-duration-mins"
            value={minutes}
            onChange={(e) => handleMinutesChange(e.target.value)}
            onBlur={commitDurationBlur}
            onPointerDown={beginMinutesScrub}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                nudgeTotalDuration('up')
                return
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                nudgeTotalDuration('down')
                return
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            aria-label="Duration minutes"
          />
          <span className="muted">m</span>
        </div>
        <button
          type="button"
          className={[
            'btn',
            'btn-ghost',
            'btn-sm',
            'task-empty-toggle',
            empty ? 'is-active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-pressed={empty}
          title={
            empty
              ? 'Show on calendar'
              : 'Empty block — hide from calendar, keep time gap'
          }
          onClick={() => setEmpty((current) => !current)}
        >
          ∅
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={busy}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
