export const REORDER_DRAG_ACTIVATE_PX = 5
export const REORDER_TOUCH_HOLD_MS = 300
export const REORDER_CLICK_SUPPRESS_PX = 3
export const REORDER_AUTO_SCROLL_EDGE_PX = 72
export const REORDER_AUTO_SCROLL_MAX_PX = 8

export function getReorderAutoScrollDelta(
  clientY: number,
  viewportTop: number,
  viewportBottom: number,
  edge = REORDER_AUTO_SCROLL_EDGE_PX,
  maxSpeed = REORDER_AUTO_SCROLL_MAX_PX,
): number {
  if (clientY < viewportTop + edge) {
    return -maxSpeed * Math.min(1, (viewportTop + edge - clientY) / edge)
  }
  if (clientY > viewportBottom - edge) {
    return maxSpeed * Math.min(1, (clientY - (viewportBottom - edge)) / edge)
  }
  return 0
}

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
  /** Enable edge scrolling for the nearest scrollable ancestor. */
  autoScroll?: boolean
  /** Called after auto-scrolling so the drop indicator can be recalculated. */
  onAutoScroll?: (clientY: number) => void
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
    autoScroll = false,
    onAutoScroll,
  } = opts

  const requiresHold = pointerType === 'touch'
  let holdReady = !requiresHold
  let active = false
  let cancelled = false
  let gestureAborted = false
  let clickSuppressed = false
  let previousY = startY
  let latestY = startY
  let autoScrollFrame: number | null = null

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
    if (autoScrollFrame != null) {
      window.cancelAnimationFrame(autoScrollFrame)
      autoScrollFrame = null
    }
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

  function nearestScrollParent(): HTMLElement | null {
    let parent = handle.parentElement
    while (parent) {
      if (parent.scrollHeight > parent.clientHeight) {
        const style = window.getComputedStyle(parent)
        if (/(auto|scroll)/.test(style.overflowY)) return parent
      }
      parent = parent.parentElement
    }
    return null
  }

  function runAutoScroll() {
    autoScrollFrame = null
    if (cancelled || !active || !autoScroll) return
    const parent = nearestScrollParent()
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    const delta = getReorderAutoScrollDelta(
      latestY,
      rect.top,
      rect.bottom,
    )
    if (delta === 0) return
    const previousScrollTop = parent.scrollTop
    parent.scrollTop += delta
    if (parent.scrollTop === previousScrollTop) return
    onAutoScroll?.(latestY)
    autoScrollFrame = window.requestAnimationFrame(runAutoScroll)
  }

  function scheduleAutoScroll(clientY: number) {
    latestY = clientY
    if (autoScroll && autoScrollFrame == null) {
      autoScrollFrame = window.requestAnimationFrame(runAutoScroll)
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
    scheduleAutoScroll(ev.clientY)
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
