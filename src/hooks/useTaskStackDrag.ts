import { useEffect, useRef, type RefObject } from 'react'
import type {
  EventDragStartArg,
  EventDragStopArg,
} from '@fullcalendar/interaction'
import type { EventDropArg } from '@fullcalendar/core'

const TASK_STACK_CLASS = 'task-event'

type StackDragState = {
  taskId: string
  subjectEl: HTMLElement
  originTop: number
  originLeft: number
  /** Horizontal placement of the subject harness (FC uses % left/right). */
  harnessLeft: string
  harnessRight: string
}

type UseTaskStackDragOptions = {
  shellRef: RefObject<HTMLElement | null>
  onStackShift: (deltaMs: number) => void
}

/** Visually moves the whole task stack while dragging one block. */
export function useTaskStackDrag({
  shellRef,
  onStackShift,
}: UseTaskStackDragOptions) {
  const stackDragRef = useRef<StackDragState | null>(null)
  const stackDragRafRef = useRef<number | null>(null)
  const onStackShiftRef = useRef(onStackShift)
  onStackShiftRef.current = onStackShift

  function clearStackDragTransforms() {
    shellRef.current
      ?.querySelectorAll<HTMLElement>(`.${TASK_STACK_CLASS}`)
      .forEach((el) => {
        el.style.transform = ''
      })
  }

  function stopStackDragTracking() {
    stackDragRef.current = null
    if (stackDragRafRef.current !== null) {
      cancelAnimationFrame(stackDragRafRef.current)
      stackDragRafRef.current = null
    }
  }

  function syncStackDragTransforms() {
    const shell = shellRef.current
    const drag = stackDragRef.current
    if (!shell || !drag) return

    const mirror = shell.querySelector<HTMLElement>('.fc-event-mirror')
    if (!mirror) return

    // FC forces mirrors to left:0/right:0 (full column). Restore the
    // subject's horizontal size so it matches the rest of the stack.
    const mirrorHarness = mirror.closest<HTMLElement>(
      '.fc-timegrid-event-harness',
    )
    if (mirrorHarness) {
      mirrorHarness.style.left = drag.harnessLeft
      mirrorHarness.style.right = drag.harnessRight
      mirrorHarness.style.width = ''
    }

    const rect = mirror.getBoundingClientRect()
    const deltaX = rect.left - drag.originLeft
    const deltaY = rect.top - drag.originTop
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
      clearStackDragTransforms()
      return
    }

    shell.querySelectorAll<HTMLElement>(`.${TASK_STACK_CLASS}`).forEach((el) => {
      if (el.classList.contains('fc-event-mirror') || el === drag.subjectEl) {
        return
      }
      el.style.transform = `translate(${deltaX}px, ${deltaY}px)`
    })
  }

  useEffect(() => {
    const shell = shellRef
    const dragRef = stackDragRef
    const rafRef = stackDragRafRef
    return () => {
      dragRef.current = null
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      shell.current
        ?.querySelectorAll<HTMLElement>(`.${TASK_STACK_CLASS}`)
        .forEach((el) => {
          el.style.transform = ''
        })
    }
  }, [shellRef])

  function handleEventDragStart(arg: EventDragStartArg) {
    const taskId = arg.event.extendedProps.taskId as string | undefined
    if (!taskId) return

    const rect = arg.el.getBoundingClientRect()
    const harness = arg.el.closest<HTMLElement>('.fc-timegrid-event-harness')
    stackDragRef.current = {
      taskId,
      subjectEl: arg.el,
      originTop: rect.top,
      originLeft: rect.left,
      harnessLeft: harness?.style.left || '0%',
      harnessRight: harness?.style.right || '0%',
    }

    const tick = () => {
      if (!stackDragRef.current) return
      syncStackDragTransforms()
      stackDragRafRef.current = requestAnimationFrame(tick)
    }
    stackDragRafRef.current = requestAnimationFrame(tick)
  }

  function handleEventDragStop(_arg: EventDragStopArg) {
    stopStackDragTracking()
    clearStackDragTransforms()
  }

  function handleEventDrop(arg: EventDropArg) {
    const taskId = arg.event.extendedProps.taskId as string | undefined
    if (!taskId || !arg.event.start || !arg.oldEvent.start) {
      arg.revert()
      return
    }
    stopStackDragTracking()
    clearStackDragTransforms()
    onStackShiftRef.current(
      arg.event.start.getTime() - arg.oldEvent.start.getTime(),
    )
  }

  return {
    handleEventDragStart,
    handleEventDragStop,
    handleEventDrop,
  }
}

export { TASK_STACK_CLASS }
