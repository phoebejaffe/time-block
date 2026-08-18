import {
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'

export const CAL_ZOOM_MIN = 0.95
export const CAL_ZOOM_MAX = 2.5

function clampZoom(value: number): number {
  return Math.min(CAL_ZOOM_MAX, Math.max(CAL_ZOOM_MIN, value))
}

function touchDistance(a: Touch, b: Touch): number {
  const dx = a.clientX - b.clientX
  const dy = a.clientY - b.clientY
  return Math.hypot(dx, dy)
}

function touchMidY(a: Touch, b: Touch): number {
  return (a.clientY + b.clientY) / 2
}

/** Vertical scroller for the time-grid slots (not the all-day row). */
export function findTimegridScroller(body: HTMLElement): HTMLElement | null {
  const slots = body.querySelector('.fc-timegrid-slots')
  return (slots?.closest('.fc-scroller') as HTMLElement | null) ?? null
}

/**
 * ScrollTop that keeps the content under `clientY` fixed when slot heights
 * scale from `oldZoom` to `newZoom`.
 */
export function anchoredScrollTop(
  scrollTop: number,
  clientY: number,
  scrollerTop: number,
  oldZoom: number,
  newZoom: number,
): number {
  if (oldZoom === 0 || oldZoom === newZoom) return scrollTop
  const offsetY = clientY - scrollerTop
  const contentY = scrollTop + offsetY
  return contentY * (newZoom / oldZoom) - offsetY
}

type ZoomAnchor = {
  clientY: number
  /** Content Y under the pointer before this zoom step (oldZoom coordinates). */
  contentY: number
  oldZoom: number
  /** Pinch: content Y locked at gesture start (startZoom coordinates). */
  contentAnchorY?: number
  startZoom?: number
}

type UseCalendarZoomOptions = {
  bodyRef: RefObject<HTMLElement | null>
  /** Remeasure after slot heights change (e.g. FullCalendar updateSize). */
  onZoomChange?: () => void
  /** Fired when a two-finger pinch begins (so calendar can cancel drag/select). */
  onPinchStart?: () => void
}

/**
 * Pinch + Ctrl/Cmd-wheel zoom for the calendar body; blocks Safari page gestures.
 * React commits `--cal-zoom`, then a layout effect remeasures and anchors scroll
 * in the same pre-paint pass so events stay aligned and the view does not jump.
 */
export function useCalendarZoom({
  bodyRef,
  onZoomChange,
  onPinchStart,
}: UseCalendarZoomOptions) {
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const pinchingRef = useRef(false)
  const pinchRef = useRef<{
    startDistance: number
    startZoom: number
    contentAnchorY: number
  } | null>(null)
  const pendingAnchorRef = useRef<ZoomAnchor | null>(null)
  const onZoomChangeRef = useRef(onZoomChange)
  const onPinchStartRef = useRef(onPinchStart)
  onZoomChangeRef.current = onZoomChange
  onPinchStartRef.current = onPinchStart

  useLayoutEffect(() => {
    zoomRef.current = zoom
    const anchor = pendingAnchorRef.current
    pendingAnchorRef.current = null

    // Slot heights from React's `--cal-zoom` are in the DOM; remeasure events
    // and pin scroll before the browser paints this frame.
    onZoomChangeRef.current?.()

    if (!anchor || !bodyRef.current) return
    const scroller = findTimegridScroller(bodyRef.current)
    if (!scroller) return

    const rect = scroller.getBoundingClientRect()
    if (
      anchor.contentAnchorY != null &&
      anchor.startZoom != null &&
      anchor.startZoom !== 0
    ) {
      scroller.scrollTop =
        anchor.contentAnchorY * (zoom / anchor.startZoom) -
        (anchor.clientY - rect.top)
      return
    }

    scroller.scrollTop =
      anchor.contentY * (zoom / anchor.oldZoom) - (anchor.clientY - rect.top)
  }, [zoom, bodyRef])

  useEffect(() => {
    function preventPageGesture(event: Event) {
      event.preventDefault()
    }
    document.addEventListener('gesturestart', preventPageGesture, {
      passive: false,
    })
    document.addEventListener('gesturechange', preventPageGesture, {
      passive: false,
    })
    document.addEventListener('gestureend', preventPageGesture, {
      passive: false,
    })
    return () => {
      document.removeEventListener('gesturestart', preventPageGesture)
      document.removeEventListener('gesturechange', preventPageGesture)
      document.removeEventListener('gestureend', preventPageGesture)
    }
  }, [])

  useEffect(() => {
    const root = bodyRef.current
    if (!root) return
    const body: HTMLElement = root

    function applyPinchScrollOnly(clientY: number): void {
      const pinch = pinchRef.current
      if (!pinch || pinch.startZoom === 0) return
      const scroller = findTimegridScroller(body)
      if (!scroller) return
      const rect = scroller.getBoundingClientRect()
      scroller.scrollTop =
        pinch.contentAnchorY * (zoomRef.current / pinch.startZoom) -
        (clientY - rect.top)
    }

    function requestZoomAroundClientY(
      nextZoom: number,
      clientY: number,
      pinch?: { contentAnchorY: number; startZoom: number },
    ): void {
      const clamped = clampZoom(nextZoom)
      const oldZoom = zoomRef.current
      const scroller = findTimegridScroller(body)

      if (clamped === oldZoom) {
        // At the zoom clamp, still follow a moving pinch midpoint.
        if (pinch) applyPinchScrollOnly(clientY)
        return
      }

      let contentY = 0
      if (scroller) {
        const rect = scroller.getBoundingClientRect()
        contentY = scroller.scrollTop + (clientY - rect.top)
      }

      pendingAnchorRef.current = {
        clientY,
        contentY,
        oldZoom,
        contentAnchorY: pinch?.contentAnchorY,
        startZoom: pinch?.startZoom,
      }
      setZoom(clamped)
    }

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length < 2) {
        pinchRef.current = null
        return
      }
      event.preventDefault()
      const wasPinching = pinchingRef.current
      pinchingRef.current = true
      const a = event.touches[0]!
      const b = event.touches[1]!
      const scroller = findTimegridScroller(body)
      const midY = touchMidY(a, b)
      let contentAnchorY = 0
      if (scroller) {
        const rect = scroller.getBoundingClientRect()
        contentAnchorY = scroller.scrollTop + (midY - rect.top)
      }
      pinchRef.current = {
        startDistance: touchDistance(a, b),
        startZoom: zoomRef.current,
        contentAnchorY,
      }
      if (!wasPinching) onPinchStartRef.current?.()
    }

    function onTouchMove(event: TouchEvent) {
      const pinch = pinchRef.current
      if (!pinch || event.touches.length !== 2) return
      event.preventDefault()
      const a = event.touches[0]!
      const b = event.touches[1]!
      if (pinch.startDistance <= 0) return
      const nextZoom =
        pinch.startZoom * (touchDistance(a, b) / pinch.startDistance)
      requestZoomAroundClientY(nextZoom, touchMidY(a, b), {
        contentAnchorY: pinch.contentAnchorY,
        startZoom: pinch.startZoom,
      })
    }

    function onTouchEnd(event: TouchEvent) {
      if (event.touches.length < 2) {
        pinchRef.current = null
        pinchingRef.current = false
      }
    }

    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const factor = Math.exp(-event.deltaY * 0.01)
      requestZoomAroundClientY(zoomRef.current * factor, event.clientY)
    }

    body.addEventListener('touchstart', onTouchStart, { passive: false })
    body.addEventListener('touchmove', onTouchMove, { passive: false })
    body.addEventListener('touchend', onTouchEnd)
    body.addEventListener('touchcancel', onTouchEnd)
    body.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      body.removeEventListener('touchstart', onTouchStart)
      body.removeEventListener('touchmove', onTouchMove)
      body.removeEventListener('touchend', onTouchEnd)
      body.removeEventListener('touchcancel', onTouchEnd)
      body.removeEventListener('wheel', onWheel)
    }
  }, [bodyRef])

  function setZoomUnanchored(next: number) {
    const clamped = clampZoom(next)
    if (clamped === zoomRef.current) return
    pendingAnchorRef.current = null
    setZoom(clamped)
  }

  return { zoom, pinchingRef, setZoomUnanchored }
}
