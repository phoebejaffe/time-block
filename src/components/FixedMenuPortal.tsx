import type { CSSProperties, ReactNode, Ref } from 'react'
import { createPortal } from 'react-dom'

type FixedMenuPortalProps = {
  open: boolean
  dropdownRef: Ref<HTMLDivElement | null>
  style: CSSProperties
  className?: string
  role?: string
  children: ReactNode
  'aria-multiselectable'?: boolean
}

export function FixedMenuPortal({
  open,
  dropdownRef,
  style,
  className,
  role = 'menu',
  children,
  ...aria
}: FixedMenuPortalProps) {
  if (!open) return null
  return createPortal(
    <div
      ref={dropdownRef}
      className={['task-new-menu-dropdown-fixed', className]
        .filter(Boolean)
        .join(' ')}
      style={style}
      role={role}
      {...aria}
    >
      {children}
    </div>,
    document.body,
  )
}
