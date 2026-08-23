export const REORDER_DRAG_ACTIVATE_PX = 5
export const REORDER_TOUCH_HOLD_MS = 200
export const REORDER_CLICK_SUPPRESS_PX = 3

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
  /** Callback to suppress click events when dragging starts */
  onSuppressClick?: () => void
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
    onSuppressClick,
  } = opts

  const requiresHold = pointerType === 'touch'
  let holdReady = !requiresHold
  let active = false
  let cancelled = false
  let gestureAborted = false
  let clickSuppressed = false
  let previousY = startY

  function capturePointer() {
    try {
      handle.setPointerCapture(pointerId)
    } catch {
      /* ignore */
    }
  }

  if (!requiresHold) capturePointer()

  const holdTimer = requiresHold
    ? window.setTimeout(() => {
        if (!cancelled && !gestureAborted) holdReady = true
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

  function scrollParentBy(parent: HTMLElement, deltaY: number): boolean {
    if (parent.scrollHeight <= parent.clientHeight) return false
    const style = window.getComputedStyle(parent)
    if (!/(auto|scroll)/.test(style.overflowY)) return false
    parent.scrollTop -= deltaY
    return true
  }

  function scrollNearestParent(deltaY: number) {
    let parent = handle.parentElement
    while (parent) {
      if (scrollParentBy(parent, deltaY)) return
      parent = parent.parentElement
    }
  }

  const onPointerMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId || cancelled) return
    const dx = ev.clientX - startX
    const dy = ev.clientY - startY
    const stepY = ev.clientY - previousY
    previousY = ev.clientY
    const dist = Math.hypot(dx, dy)

    // Suppress clicks on any significant movement, even if drag doesn't fully activate
    if (!clickSuppressed && dist >= REORDER_CLICK_SUPPRESS_PX) {
      clickSuppressed = true
      onSuppressClick?.()
    }

    if (!holdReady || gestureAborted) {
      if (pointerType === 'touch' && stepY !== 0) {
        scrollNearestParent(stepY)
      }
      if (dist >= REORDER_DRAG_ACTIVATE_PX) gestureAborted = true
      return
    }

    if (!active) {
      if (dist < REORDER_DRAG_ACTIVATE_PX) return
      if (shouldAbortMove?.(dx, dy)) {
        cleanup()
        return
      }
      active = true
      capturePointer()
      onActivate()
    }

    ev.preventDefault()
    onMove(ev)
  }

  const onPointerUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    const didActivate = active
    if (didActivate) ev.preventDefault()
    // Suppress click if we moved significantly, even if drag didn't fully activate
    if (clickSuppressed) onSuppressClick?.()
    onEnd(ev, didActivate)
    cleanup()
  }

  document.addEventListener('pointermove', onPointerMove, { passive: false })
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', onPointerUp)

  return cleanup
}
