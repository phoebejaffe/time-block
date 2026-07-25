import { useEffect, useRef, type RefObject } from 'react'
import type {
  EventDragStartArg,
  EventDragStopArg,
} from '@fullcalendar/interaction'

const TASK_STACK_CLASS = 'task-event'
/** Must match FullCalendar `slotDuration` in CalendarView. */
const SLOT_MS = 15 * 60_000

export type StackDragVisual = {
  /** Grab-corrected stack shift in ms (same value used on drop). */
  deltaMs: number | null
  /**
   * Constant pixel correction for FC's grid mirror so it lines up with
   * siblings (cancels the first-frame useEventCenter / snap jump).
   */
  mirrorNudgeMs: number
}

type StackDragState = {
  taskId: string
  groupId: string
  /** Horizontal placement of the subject harness (FC uses % left/right). */
  harnessLeft: string
  harnessRight: string
}

type UseTaskStackDragOptions = {
  shellRef: RefObject<HTMLElement | null>
  getVisual: () => StackDragVisual
  /** Called each drag frame after mirror/sibling transforms (e.g. refresh labels). */
  onDragFrame?: () => void
}

/**
 * Nudges FullCalendar's drag mirror and applies an immediate translateY to
 * sibling blocks while dragging.
 *
 * Siblings can't wait on a React re-render (that lags a frame behind FC's
 * mirror). CalendarView keeps unshifted `groups` during drag and moves
 * siblings here; App's `previewGroups` still shifts the anchor for sidebar.
 */
export function useTaskStackDrag({
  shellRef,
  getVisual,
  onDragFrame,
}: UseTaskStackDragOptions) {
  const stackDragRef = useRef<StackDragState | null>(null)
  const stackDragRafRef = useRef<number | null>(null)
  const getVisualRef = useRef(getVisual)
  getVisualRef.current = getVisual
  const onDragFrameRef = useRef(onDragFrame)
  onDragFrameRef.current = onDragFrame

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

  function slotHeightPx(shell: HTMLElement): number | null {
    const slot = shell.querySelector<HTMLElement>(
      '.fc-timegrid-body .fc-timegrid-slot',
    )
    if (!slot) return null
    const h = slot.getBoundingClientRect().height
    return h > 0 ? h : null
  }

  function msToTranslateY(deltaMs: number, slotH: number): string {
    const deltaY = (deltaMs / SLOT_MS) * slotH
    return Math.abs(deltaY) < 0.5 ? '' : `translateY(${deltaY}px)`
  }

  function syncStackDragTransforms() {
    const shell = shellRef.current
    const drag = stackDragRef.current
    if (!shell || !drag) return

    const { deltaMs, mirrorNudgeMs } = getVisualRef.current()
    const slotH = slotHeightPx(shell)
    if (slotH == null) {
      clearStackDragTransforms()
      return
    }

    const siblingTransform =
      deltaMs == null ? '' : msToTranslateY(deltaMs, slotH)
    const mirrorTransform = msToTranslateY(mirrorNudgeMs, slotH)

    const mirror = shell.querySelector<HTMLElement>('.fc-event-mirror')
    if (mirror) {
      mirror.dataset.groupId = drag.groupId
      mirror.dataset.taskId = drag.taskId
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
      mirror.style.transform = mirrorTransform
    }

    shell.querySelectorAll<HTMLElement>(`.${TASK_STACK_CLASS}`).forEach((el) => {
      if (el.classList.contains('fc-event-mirror')) return
      if (el.dataset.groupId !== drag.groupId) return
      if (el.dataset.taskId === drag.taskId) return
      el.style.transform = siblingTransform
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

    const harness = arg.el.closest<HTMLElement>('.fc-timegrid-event-harness')
    arg.el.dataset.groupId = groupId
    stackDragRef.current = {
      taskId,
      groupId,
      harnessLeft: harness?.style.left || '0%',
      harnessRight: harness?.style.right || '0%',
    }

    const tick = () => {
      if (!stackDragRef.current) return
      syncStackDragTransforms()
      onDragFrameRef.current?.()
      stackDragRafRef.current = requestAnimationFrame(tick)
    }
    stackDragRafRef.current = requestAnimationFrame(tick)
  }

  /** Stops tracking; keep transforms until finalize clears them. */
  function handleEventDragStop(_arg: EventDragStopArg) {
    stopStackDragTracking()
  }

  return {
    handleEventDragStart,
    handleEventDragStop,
    cancelStackDrag,
    syncStackDragTransforms,
  }
}

export { TASK_STACK_CLASS }
