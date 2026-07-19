import { useEffect, useRef, type RefObject } from 'react'
import type {
  EventDragStartArg,
  EventDragStopArg,
} from '@fullcalendar/interaction'

const TASK_STACK_CLASS = 'task-event'

type StackDragState = {
  taskId: string
  groupId: string
  subjectEl: HTMLElement
  /** Event top/left at drag start (viewport coords). */
  originTop: number
  originLeft: number
  /** Pointer offset within the event at grab time. */
  grabOffsetX: number
  grabOffsetY: number
  pointerX: number
  pointerY: number
  clearMoveListeners: () => void
}

type UseTaskStackDragOptions = {
  shellRef: RefObject<HTMLElement | null>
}

function clientPoint(ev: Event): { x: number; y: number } | null {
  if ('clientX' in ev && typeof (ev as PointerEvent).clientX === 'number') {
    const e = ev as PointerEvent
    return { x: e.clientX, y: e.clientY }
  }
  const t =
    (ev as TouchEvent).touches?.[0] ?? (ev as TouchEvent).changedTouches?.[0]
  if (t) return { x: t.clientX, y: t.clientY }
  return null
}

/**
 * Visually moves one group's task stack while dragging a block in that group.
 * Tracks grab offset so the stack follows the finger/cursor without jumping.
 * Time commits happen in CalendarView via that group's stack anchor.
 */
export function useTaskStackDrag({ shellRef }: UseTaskStackDragOptions) {
  const stackDragRef = useRef<StackDragState | null>(null)
  const stackDragRafRef = useRef<number | null>(null)

  function clearStackDragTransforms() {
    shellRef.current
      ?.querySelectorAll<HTMLElement>(`.${TASK_STACK_CLASS}`)
      .forEach((el) => {
        el.style.transform = ''
      })
  }

  function stopStackDragTracking() {
    const drag = stackDragRef.current
    drag?.clearMoveListeners()
    stackDragRef.current = null
    if (stackDragRafRef.current !== null) {
      cancelAnimationFrame(stackDragRafRef.current)
      stackDragRafRef.current = null
    }
    document.body.classList.remove('is-cal-stack-dragging')
  }

  function cancelStackDrag() {
    stopStackDragTracking()
    clearStackDragTransforms()
  }

  function syncStackDragTransforms() {
    const shell = shellRef.current
    const drag = stackDragRef.current
    if (!shell || !drag) return

    // Place the stack from the live pointer minus where we grabbed inside the event.
    const deltaX = drag.pointerX - drag.grabOffsetX - drag.originLeft
    const deltaY = drag.pointerY - drag.grabOffsetY - drag.originTop
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
      clearStackDragTransforms()
      return
    }

    const floating = document.querySelector<HTMLElement>('.fc-event-dragging')
    if (floating) {
      floating.style.width = `${drag.subjectEl.getBoundingClientRect().width}px`
    }

    shell.querySelectorAll<HTMLElement>(`.${TASK_STACK_CLASS}`).forEach((el) => {
      if (el.classList.contains('fc-event-dragging')) return
      if (el.classList.contains('fc-event-mirror')) return
      if (el === drag.subjectEl) return
      if (el.dataset.groupId !== drag.groupId) return
      el.style.transform = `translate(${deltaX}px, ${deltaY}px)`
    })
  }

  useEffect(() => {
    const shell = shellRef
    const rafRef = stackDragRafRef
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      document.body.classList.remove('is-cal-stack-dragging')
      shell.current
        ?.querySelectorAll<HTMLElement>(`.${TASK_STACK_CLASS}`)
        .forEach((el) => {
          el.style.transform = ''
        })
    }
  }, [shellRef])

  function handleEventDragStart(arg: EventDragStartArg) {
    const taskId = arg.event.extendedProps.taskId as string | undefined
    const groupId = arg.event.extendedProps.groupId as string | undefined
    if (!taskId || !groupId) return

    const rect = arg.el.getBoundingClientRect()
    const point = clientPoint(arg.jsEvent) ?? {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }
    arg.el.dataset.groupId = groupId

    const onPointerMove = (ev: Event) => {
      const drag = stackDragRef.current
      const next = clientPoint(ev)
      if (!drag || !next) return
      drag.pointerX = next.x
      drag.pointerY = next.y
    }
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('touchmove', onPointerMove, { passive: true })

    stackDragRef.current = {
      taskId,
      groupId,
      subjectEl: arg.el,
      originTop: rect.top,
      originLeft: rect.left,
      grabOffsetX: point.x - rect.left,
      grabOffsetY: point.y - rect.top,
      pointerX: point.x,
      pointerY: point.y,
      clearMoveListeners: () => {
        document.removeEventListener('pointermove', onPointerMove)
        document.removeEventListener('touchmove', onPointerMove)
      },
    }
    document.body.classList.add('is-cal-stack-dragging')

    const tick = () => {
      if (!stackDragRef.current) return
      syncStackDragTransforms()
      stackDragRafRef.current = requestAnimationFrame(tick)
    }
    stackDragRafRef.current = requestAnimationFrame(tick)
  }

  /** Stops mirror tracking; keep transforms until finalize clears them. */
  function handleEventDragStop(_arg: EventDragStopArg) {
    stopStackDragTracking()
  }

  return {
    handleEventDragStart,
    handleEventDragStop,
    cancelStackDrag,
  }
}

export { TASK_STACK_CLASS }
