export const REORDER_DRAG_ACTIVATE_PX = 5
export const REORDER_TOUCH_HOLD_MS = 300

/** Swallow one click after reorder drag; returns true if suppressed. */
export function consumeReorderClickSuppression(ref: {
  current: boolean
}): boolean {
  if (!ref.current) return false
  ref.current = false
  return true
}

type AttachReorderDragOptions = {
  handle: HTMLElement
  pointerId: number
  pointerType: string
  startX: number
  startY: number
  onActivate: () => void
  onMove: (ev: PointerEvent) => void
  onEnd: (ev: PointerEvent, didActivate: boolean) => void
  /** Return true to abort the gesture (e.g. horizontal swipe). */
  shouldAbortMove?: (dx: number, dy: number) => boolean
}

/** Pointer listeners for list reorder; touch requires a short hold first. */
export function attachReorderDragListeners(
  opts: AttachReorderDragOptions,
): () => void {
  const {
    handle,
    pointerId,
    pointerType,
    startX,
    startY,
    onActivate,
    onMove,
    onEnd,
    shouldAbortMove,
  } = opts

  const requiresHold = pointerType === 'touch'
  let holdReady = !requiresHold
  let active = false
  let cancelled = false

  try {
    handle.setPointerCapture(pointerId)
  } catch {
    /* ignore */
  }

  const holdTimer = requiresHold
    ? window.setTimeout(() => {
        if (!cancelled) holdReady = true
      }, REORDER_TOUCH_HOLD_MS)
    : null

  const cleanup = () => {
    if (cancelled) return
    cancelled = true
    if (holdTimer != null) window.clearTimeout(holdTimer)
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', onPointerUp)
    try {
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId)
      }
    } catch {
      /* ignore */
    }
  }

  const onPointerMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId || cancelled) return
    const dx = ev.clientX - startX
    const dy = ev.clientY - startY
    const dist = Math.hypot(dx, dy)

    if (!holdReady) {
      if (dist >= REORDER_DRAG_ACTIVATE_PX) cleanup()
      return
    }

    if (!active) {
      if (dist < REORDER_DRAG_ACTIVATE_PX) return
      if (shouldAbortMove?.(dx, dy)) {
        cleanup()
        return
      }
      active = true
      onActivate()
    }

    ev.preventDefault()
    onMove(ev)
  }

  const onPointerUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    const didActivate = active
    if (didActivate) ev.preventDefault()
    onEnd(ev, didActivate)
    cleanup()
  }

  document.addEventListener('pointermove', onPointerMove, { passive: false })
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', onPointerUp)

  return cleanup
}
