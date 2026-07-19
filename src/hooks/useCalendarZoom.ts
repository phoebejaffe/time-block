import { useEffect, useRef, useState, type RefObject } from 'react'

const CAL_ZOOM_MIN = 0.7
const CAL_ZOOM_MAX = 2.5

function clampZoom(value: number): number {
  return Math.min(CAL_ZOOM_MAX, Math.max(CAL_ZOOM_MIN, value))
}

function touchDistance(a: Touch, b: Touch): number {
  const dx = a.clientX - b.clientX
  const dy = a.clientY - b.clientY
  return Math.hypot(dx, dy)
}

type UseCalendarZoomOptions = {
  bodyRef: RefObject<HTMLElement | null>
  onZoomChange?: () => void
  /** Fired when a two-finger pinch begins (so calendar can cancel drag/select). */
  onPinchStart?: () => void
}

/** Pinch + Ctrl/Cmd-wheel zoom for the calendar body; blocks Safari page gestures. */
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
  } | null>(null)
  const onZoomChangeRef = useRef(onZoomChange)
  const onPinchStartRef = useRef(onPinchStart)
  onZoomChangeRef.current = onZoomChange
  onPinchStartRef.current = onPinchStart

  useEffect(() => {
    zoomRef.current = zoom
    onZoomChangeRef.current?.()
  }, [zoom])

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
    const el = bodyRef.current
    if (!el) return

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length < 2) {
        pinchRef.current = null
        return
      }
      event.preventDefault()
      const wasPinching = pinchingRef.current
      pinchingRef.current = true
      pinchRef.current = {
        startDistance: touchDistance(event.touches[0]!, event.touches[1]!),
        startZoom: zoomRef.current,
      }
      if (!wasPinching) onPinchStartRef.current?.()
    }

    function onTouchMove(event: TouchEvent) {
      const pinch = pinchRef.current
      if (!pinch || event.touches.length !== 2) return
      event.preventDefault()
      const distance = touchDistance(event.touches[0]!, event.touches[1]!)
      if (pinch.startDistance <= 0) return
      setZoom(clampZoom(pinch.startZoom * (distance / pinch.startDistance)))
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
      setZoom((prev) => clampZoom(prev * factor))
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('wheel', onWheel)
    }
  }, [bodyRef])

  return { zoom, pinchingRef }
}
