import { useEffect, useRef, type RefObject } from 'react'
import { clampSidebarWidth } from '../hooks/useSidebarWidth'

type SidebarResizeHandleProps = {
  bodyRef: RefObject<HTMLElement | null>
  onWidthChange: (widthPx: number) => void
}

/** Drag handle between sidebar and calendar on wide layouts. */
export function SidebarResizeHandle({
  bodyRef,
  onWidthChange,
}: SidebarResizeHandleProps) {
  const draggingRef = useRef(false)

  useEffect(() => {
    function onMove(event: PointerEvent) {
      if (!draggingRef.current) return
      const body = bodyRef.current
      if (!body) return
      const rect = body.getBoundingClientRect()
      if (rect.width <= 0) return
      // Leave room for the calendar; cap at ~70% of the body.
      const maxWidth = Math.min(900, rect.width * 0.7)
      const next = clampSidebarWidth(event.clientX - rect.left, maxWidth)
      onWidthChange(next)
    }

    function onUp() {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.classList.remove('is-sidebar-resizing')
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }
  }, [bodyRef, onWidthChange])

  return (
    <div
      className="sidebar-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      onPointerDown={(event) => {
        event.preventDefault()
        draggingRef.current = true
        document.body.classList.add('is-sidebar-resizing')
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          /* ignore */
        }
      }}
    >
      <span className="sidebar-resize-grip" aria-hidden />
    </div>
  )
}
