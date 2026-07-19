import { useEffect, useRef, type RefObject } from 'react'
import { clampMobileSplit } from '../hooks/useMobileSplit'

type MobileSplitHandleProps = {
  bodyRef: RefObject<HTMLElement | null>
  onSplitChange: (percent: number) => void
}

/** Drag handle between sidebar and calendar on narrow layouts. */
export function MobileSplitHandle({
  bodyRef,
  onSplitChange,
}: MobileSplitHandleProps) {
  const draggingRef = useRef(false)

  useEffect(() => {
    function onMove(event: PointerEvent) {
      if (!draggingRef.current) return
      const body = bodyRef.current
      if (!body) return
      const rect = body.getBoundingClientRect()
      if (rect.height <= 0) return
      const next = clampMobileSplit(
        ((event.clientY - rect.top) / rect.height) * 100,
      )
      onSplitChange(next)
    }

    function onUp() {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.classList.remove('is-split-dragging')
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }
  }, [bodyRef, onSplitChange])

  return (
    <div
      className="mobile-split"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize panels"
      onPointerDown={(event) => {
        event.preventDefault()
        draggingRef.current = true
        document.body.classList.add('is-split-dragging')
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          /* ignore */
        }
      }}
    >
      <span className="mobile-split-grip" aria-hidden />
    </div>
  )
}
