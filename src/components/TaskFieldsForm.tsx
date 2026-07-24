import { useEffect, useRef, useState } from 'react'
import type { Task } from '../lib/tasks'

const ANCHOR_SCRUB_PX = 25
const ANCHOR_SCRUB_ACTIVATE_PX = 8

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
}) {
  const [title, setTitle] = useState(initialTitle)
  const [durationMinutes, setDurationMinutes] = useState<number | ''>(
    initialDuration,
  )
  const [empty, setEmpty] = useState(initialEmpty)
  const durationRef = useRef(durationMinutes)
  durationRef.current = durationMinutes

  useEffect(() => {
    if (!onTaskEditPreview || !previewGroupId || !previewTaskId) return
    const duration =
      durationMinutes === ''
        ? initialDuration
        : Math.max(1, Math.round(durationMinutes) || initialDuration)
    onTaskEditPreview({
      groupId: previewGroupId,
      taskId: previewTaskId,
      title: title.trim() || initialTitle,
      durationMinutes: duration,
      ...(empty ? { empty: true } : {}),
    })
  }, [
    title,
    durationMinutes,
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

  function parseDuration(value: number | ''): number {
    if (value === '') return 15
    return Math.max(1, Math.round(value) || 15)
  }

  function stepDurationByFive(
    current: number | '',
    direction: 'up' | 'down',
  ): number {
    const value = parseDuration(current)
    if (direction === 'up') {
      if (value % 5 === 0) return value + 5
      return Math.ceil(value / 5) * 5
    }
    if (value % 5 === 0) return Math.max(1, value - 5)
    return Math.max(1, Math.floor(value / 5) * 5)
  }

  function beginDurationScrub(e: React.PointerEvent<HTMLInputElement>) {
    if (e.button !== 0) return
    const input = e.currentTarget
    const startY = e.clientY
    const startX = e.clientX
    const pointerId = e.pointerId
    let active = false
    let lastTick = 0
    const origin = parseDuration(durationRef.current)

    function durationForTick(tick: number): number {
      if (tick === 0) return origin
      if (tick > 0) {
        const floor = Math.floor(origin / 5) * 5
        return Math.max(1, floor + tick * 5)
      }
      const ceil = Math.ceil(origin / 5) * 5
      return Math.max(1, ceil + tick * 5)
    }

    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!active) {
        if (Math.abs(dy) < ANCHOR_SCRUB_ACTIVATE_PX) return
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
      const tick = Math.trunc(-dy / ANCHOR_SCRUB_PX)
      if (tick === lastTick) return
      lastTick = tick
      setDurationMinutes(durationForTick(tick))
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

  function nudgeDuration(direction: 'up' | 'down') {
    setDurationMinutes((current) => stepDurationByFive(current, direction))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    onSubmit({
      title: title.trim(),
      durationMinutes: parseDuration(durationMinutes),
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
            min={1}
            step={5}
            value={durationMinutes}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') {
                setDurationMinutes('')
                return
              }
              const next = Number(raw)
              setDurationMinutes(Number.isFinite(next) ? next : '')
            }}
            onBlur={() => {
              setDurationMinutes(parseDuration(durationMinutes))
            }}
            onPointerDown={beginDurationScrub}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                nudgeDuration('up')
                return
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                nudgeDuration('down')
                return
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            aria-label="Duration in minutes"
          />
          <span className="muted">mins</span>
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
