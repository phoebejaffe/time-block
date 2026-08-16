import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'
import {
  layoutFixedMenu,
  type FixedMenuAlign,
} from '../lib/fixedMenu'

type UseFixedMenuOptions = {
  open: boolean
  align?: FixedMenuAlign
  constrainHeight?: boolean
  minWidth?: number
  maxWidth?: number
  matchTriggerWidth?: boolean
}

function scrollParentsOf(el: HTMLElement | null): HTMLElement[] {
  const parents: HTMLElement[] = []
  let node = el?.parentElement
  while (node) {
    const { overflow, overflowY } = getComputedStyle(node)
    if (/(auto|scroll|overlay)/.test(`${overflow}${overflowY}`)) {
      parents.push(node)
    }
    node = node.parentElement
  }
  return parents
}

function sameStyle(a: CSSProperties, b: CSSProperties): boolean {
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.maxHeight === b.maxHeight
  )
}

/**
 * Positions a portaled dropdown against its trigger using viewport
 * coordinates, and keeps it there across resize, scroll, and size changes.
 */
export function useFixedMenu<T extends HTMLElement = HTMLButtonElement>({
  open,
  align = 'end',
  constrainHeight = false,
  minWidth,
  maxWidth,
  matchTriggerWidth = false,
}: UseFixedMenuOptions): {
  triggerRef: RefObject<T | null>
  dropdownRef: RefObject<HTMLDivElement | null>
  style: CSSProperties
} {
  const triggerRef = useRef<T | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const [style, setStyle] = useState<CSSProperties>({})

  useLayoutEffect(() => {
    if (!open) {
      setStyle({})
      return
    }

    function reposition() {
      const trigger = triggerRef.current
      const dropdown = dropdownRef.current
      if (!trigger || !dropdown) return

      const layout = layoutFixedMenu({
        trigger: trigger.getBoundingClientRect(),
        dropdown: {
          width: dropdown.offsetWidth,
          height: constrainHeight ? dropdown.scrollHeight : dropdown.offsetHeight,
        },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        align,
        constrainHeight,
        minWidth,
        maxWidth,
        matchTriggerWidth,
      })
      const next: CSSProperties = {
        position: 'fixed',
        top: layout.top,
        left: layout.left,
        bottom: 'auto',
        right: 'auto',
        ...(layout.width != null ? { width: layout.width } : {}),
        ...(layout.maxHeight != null ? { maxHeight: layout.maxHeight } : {}),
      }
      setStyle((prev) => (sameStyle(prev, next) ? prev : next))
    }

    reposition()

    const scrollParents = scrollParentsOf(triggerRef.current)
    window.addEventListener('resize', reposition)
    for (const parent of scrollParents) {
      parent.addEventListener('scroll', reposition, { passive: true })
    }
    const observer = new ResizeObserver(reposition)
    if (dropdownRef.current) observer.observe(dropdownRef.current)
    if (triggerRef.current) observer.observe(triggerRef.current)

    return () => {
      window.removeEventListener('resize', reposition)
      for (const parent of scrollParents) {
        parent.removeEventListener('scroll', reposition)
      }
      observer.disconnect()
    }
  }, [open, align, constrainHeight, minWidth, maxWidth, matchTriggerWidth])

  return { triggerRef, dropdownRef, style }
}
