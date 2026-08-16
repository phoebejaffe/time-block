export const FIXED_MENU_GAP = 6
export const FIXED_MENU_PAD = 8

export type FixedMenuAlign = 'start' | 'end'

export type FixedMenuBox = {
  top: number
  bottom: number
  left: number
  right: number
  width: number
}

export type FixedMenuSize = {
  width: number
  height: number
}

export type FixedMenuViewport = {
  width: number
  height: number
}

export type FixedMenuInput = {
  trigger: FixedMenuBox
  dropdown: FixedMenuSize
  viewport: FixedMenuViewport
  align?: FixedMenuAlign
  /** Cap height and open toward the side with more room (tall pickers). */
  constrainHeight?: boolean
  minWidth?: number
  maxWidth?: number
  matchTriggerWidth?: boolean
}

export type FixedMenuLayout = {
  top: number
  left: number
  width?: number
  maxHeight?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function resolvedWidth(input: FixedMenuInput): number {
  const { trigger, dropdown, viewport, minWidth, maxWidth, matchTriggerWidth } =
    input
  let width = matchTriggerWidth ? trigger.width : dropdown.width
  if (minWidth != null) width = Math.max(width, minWidth)
  if (maxWidth != null) width = Math.min(width, maxWidth)
  return Math.min(width, Math.max(0, viewport.width - FIXED_MENU_PAD * 2))
}

function alignedLeft(
  trigger: FixedMenuBox,
  width: number,
  viewport: FixedMenuViewport,
  align: FixedMenuAlign,
): number {
  const left = align === 'end' ? trigger.right - width : trigger.left
  return clamp(left, FIXED_MENU_PAD, viewport.width - width - FIXED_MENU_PAD)
}

/**
 * Viewport-fixed coordinates for a portaled dropdown, flipping above/below
 * the trigger and clamping so the panel stays on-screen.
 */
export function layoutFixedMenu(input: FixedMenuInput): FixedMenuLayout {
  const gap = FIXED_MENU_GAP
  const pad = FIXED_MENU_PAD
  const align = input.align ?? 'end'
  const { trigger, dropdown, viewport } = input
  const setsWidth =
    input.matchTriggerWidth ||
    input.minWidth != null ||
    input.maxWidth != null
  const width = resolvedWidth(input)
  const spaceBelow = viewport.height - trigger.bottom - pad
  const spaceAbove = trigger.top - pad

  if (input.constrainHeight) {
    const openDown = spaceBelow >= spaceAbove
    const available = (openDown ? spaceBelow : spaceAbove) - gap
    const viewportCap = viewport.height * 0.75 - pad * 2
    const maxHeight = Math.max(160, Math.min(available, viewportCap))
    const height = Math.min(dropdown.height, maxHeight)
    let top = openDown ? trigger.bottom + gap : trigger.top - height - gap
    top = clamp(top, pad, viewport.height - pad - Math.min(height, maxHeight))
    return {
      top,
      left: alignedLeft(trigger, width, viewport, align),
      ...(setsWidth ? { width } : {}),
      maxHeight,
    }
  }

  const height = dropdown.height
  const openUp =
    spaceAbove >= height + gap &&
    (spaceAbove >= spaceBelow || spaceBelow < height + gap)
  let top = openUp ? trigger.top - height - gap : trigger.bottom + gap
  top = clamp(top, pad, viewport.height - pad - height)
  return {
    top,
    left: alignedLeft(trigger, width, viewport, align),
    ...(setsWidth ? { width } : {}),
  }
}
