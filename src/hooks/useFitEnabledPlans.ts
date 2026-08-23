import {
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from 'react'
import {
  CALENDAR_SLOT_MINUTES,
  FIT_DEBOUNCE_MS,
  FIT_PADDING_PX,
  FIT_SCROLL_MS,
  calendarSlotBounds,
  clockMinutes,
  enabledPlansFingerprint,
  enabledPlansTimeRange,
  easeOut,
  fitAnimFrame,
  planFit,
} from '../lib/calendarFit'
import type { BlockGroup } from '../lib/tasks'
import { CAL_ZOOM_MIN, findTimegridScroller } from './useCalendarZoom'

const ZOOM_EPS = 1e-4

function interactionBlocked(): boolean {
  return (
    document.body.classList.contains('is-datetime-scrubbing') ||
    document.body.classList.contains('is-calendar-dragging')
  )
}

function slotHeightPx(scroller: HTMLElement): number {
  const slot = scroller.querySelector('.fc-timegrid-slot') as HTMLElement | null
  if (!slot) return 0
  const height = slot.getBoundingClientRect().height
  return height > 0 ? height : 0
}

type AnimRunning = {
  frame: number | null
  cancelled: boolean
}

function animateFit(options: {
  scroller: HTMLElement
  fromZoom: number
  toZoom: number
  fromScroll: number
  toScroll: number
  setZoom: (next: number) => void
  pendingScrollRef: { current: number | null }
  running: AnimRunning
  durationMs: number
}) {
  const {
    scroller,
    fromZoom,
    toZoom,
    fromScroll,
    toScroll,
    setZoom,
    pendingScrollRef,
    running,
    durationMs,
  } = options
  if (running.frame != null) {
    cancelAnimationFrame(running.frame)
    running.frame = null
  }

  const zooming = Math.abs(toZoom - fromZoom) > ZOOM_EPS
  const scrolling = Math.abs(toScroll - fromScroll) >= 1
  if (!zooming && !scrolling) return

  const started = performance.now()
  function frame(now: number) {
    if (running.cancelled) return
    const t = Math.min(1, (now - started) / durationMs)
    const { zoom, scrollTop } = fitAnimFrame(
      easeOut(t),
      fromZoom,
      toZoom,
      fromScroll,
      toScroll,
    )
    if (zooming) {
      pendingScrollRef.current = scrollTop
      setZoom(zoom)
    } else {
      scroller.scrollTop = scrollTop
    }
    if (t < 1) {
      running.frame = requestAnimationFrame(frame)
      return
    }
    running.frame = null
    scroller.scrollTop = scrollTop
  }
  running.frame = requestAnimationFrame(frame)
}

type UseFitEnabledPlansOptions = {
  groups: BlockGroup[]
  bodyRef: RefObject<HTMLElement | null>
  zoom: number
  setZoomUnanchored: (next: number) => void
  pinchingRef: RefObject<boolean>
  calendarHeight: number
  /** When true (execution), fit on first layout instead of keeping scrollTime. */
  fitOnMount?: boolean
  /** Now-bar bias only when today's column is on screen. */
  includeNow?: boolean
}

/**
 * Scroll (and zoom out if needed) so enabled stacks are in view. Debounced;
 * skipped while scrubbing, dragging, or pinching; no-op when already visible.
 */
export function useFitEnabledPlans({
  groups,
  bodyRef,
  zoom,
  setZoomUnanchored,
  pinchingRef,
  calendarHeight,
  fitOnMount = false,
  includeNow = false,
}: UseFitEnabledPlansOptions) {
  const fingerprint = enabledPlansFingerprint(groups)
  const skippedInitialRef = useRef(false)
  const pendingScrollRef = useRef<number | null>(null)
  const animRef = useRef<AnimRunning>({ frame: null, cancelled: false })
  const groupsRef = useRef(groups)
  groupsRef.current = groups
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const setZoomRef = useRef(setZoomUnanchored)
  setZoomRef.current = setZoomUnanchored
  const pinchingRefStable = pinchingRef

  useEffect(() => {
    const running = animRef.current
    running.cancelled = false
    return () => {
      running.cancelled = true
      if (running.frame != null) {
        cancelAnimationFrame(running.frame)
        running.frame = null
      }
    }
  }, [])

  // After React commits `--cal-zoom`, pin scroll for this animation frame
  // (updateSize has already run in useCalendarZoom's layout effect).
  useLayoutEffect(() => {
    const next = pendingScrollRef.current
    if (next == null) return
    const body = bodyRef.current
    if (!body) return
    const scroller = findTimegridScroller(body)
    if (!scroller) return
    scroller.scrollTop = next
    pendingScrollRef.current = null
  }, [zoom, bodyRef])

  useEffect(() => {
    if (calendarHeight < 2) return
    if (!fitOnMount && !skippedInitialRef.current) {
      skippedInitialRef.current = true
      return
    }

    const pinching = pinchingRefStable
    const groupsNow = groupsRef
    const zoomNow = zoomRef
    const setZoom = setZoomRef
    const pendingScroll = pendingScrollRef
    const anim = animRef.current
    const bodyEl = bodyRef

    function applyFit(): 'done' | 'retry' {
      if (pinching.current || interactionBlocked()) return 'retry'
      const body = bodyEl.current
      if (!body) return 'retry'
      const scroller = findTimegridScroller(body)
      if (!scroller) return 'retry'
      const range = enabledPlansTimeRange(groupsNow.current)
      if (!range) return 'done'
      const slotH = slotHeightPx(scroller)
      if (slotH <= 0) return 'retry'
      const slotBounds = calendarSlotBounds(range)

      const fromZoom = zoomNow.current
      const fit = planFit({
        startMinutes: range.startMinutes,
        endMinutes: range.endMinutes,
        slotMinMinutes: slotBounds.minMinutes,
        slotMaxMinutes: slotBounds.maxMinutes,
        slotMinutes: CALENDAR_SLOT_MINUTES,
        slotHeight: slotH,
        scrollTop: scroller.scrollTop,
        viewHeight: scroller.clientHeight,
        zoom: fromZoom,
        minZoom: CAL_ZOOM_MIN,
        paddingPx: FIT_PADDING_PX,
        nowMinutes: includeNow ? clockMinutes(new Date()) : undefined,
      })

      if (fit.kind === 'visible') return 'done'

      const toZoom = fit.kind === 'zoom' ? fit.zoom : fromZoom
      const fromScroll = scroller.scrollTop
      const toScroll = fit.scrollTop

      animateFit({
        scroller,
        fromZoom,
        toZoom,
        fromScroll,
        toScroll,
        setZoom: setZoom.current,
        pendingScrollRef: pendingScroll,
        running: anim,
        durationMs: FIT_SCROLL_MS,
      })
      return 'done'
    }

    let timer: ReturnType<typeof setTimeout> | undefined

    function schedule() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (applyFit() === 'retry') schedule()
      }, FIT_DEBOUNCE_MS)
    }

    schedule()
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [
    fingerprint,
    calendarHeight,
    fitOnMount,
    includeNow,
    bodyRef,
    pinchingRefStable,
  ])
}
