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
  originTop: number
  originLeft: number
  /** Horizontal placement of the subject harness (FC uses % left/right). */
  harnessLeft: string
  harnessRight: string
}

type UseTaskStackDragOptions = {
  shellRef: RefObject<HTMLElement | null>
}

/**
 * Visually moves one group's task stack while dragging a block in that group.
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
    stackDragRef.current = null
    if (stackDragRafRef.current !== null) {
      cancelAnimationFrame(stackDragRafRef.current)
      stackDragRafRef.current = null
    }
  }

  function cancelStackDrag() {
    stopStackDragTracking()
    clearStackDragTransforms()
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
    const harness = arg.el.closest<HTMLElement>('.fc-timegrid-event-harness')
    arg.el.dataset.groupId = groupId
    stackDragRef.current = {
      taskId,
      groupId,
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
