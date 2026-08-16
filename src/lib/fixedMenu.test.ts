import { describe, expect, it } from 'vitest'
import { FIXED_MENU_GAP, FIXED_MENU_PAD, layoutFixedMenu } from './fixedMenu'

const viewport = { width: 1000, height: 800 }

function triggerAt(left: number, top: number, width = 32, height = 24) {
  return {
    top,
    bottom: top + height,
    left,
    right: left + width,
    width,
  }
}

describe('layoutFixedMenu', () => {
  it('opens below an end-aligned trigger when there is room', () => {
    const trigger = triggerAt(900, 40)
    const layout = layoutFixedMenu({
      trigger,
      dropdown: { width: 180, height: 120 },
      viewport,
      align: 'end',
    })
    expect(layout.top).toBe(trigger.bottom + FIXED_MENU_GAP)
    expect(layout.left).toBe(trigger.right - 180)
    expect(layout.width).toBeUndefined()
    expect(layout.maxHeight).toBeUndefined()
  })

  it('flips above when there is not enough room below', () => {
    const dropdown = { width: 180, height: 200 }
    const trigger = triggerAt(100, 700)
    const layout = layoutFixedMenu({
      trigger,
      dropdown,
      viewport,
      align: 'start',
    })
    expect(layout.top).toBe(trigger.top - dropdown.height - FIXED_MENU_GAP)
    expect(layout.left).toBe(trigger.left)
  })

  it('clamps horizontally so the panel stays in the viewport', () => {
    const layout = layoutFixedMenu({
      trigger: triggerAt(20, 40, 32),
      dropdown: { width: 240, height: 80 },
      viewport: { width: 200, height: 400 },
      align: 'end',
    })
    expect(layout.left).toBe(FIXED_MENU_PAD)
  })

  it('sizes a constrained picker to the trigger and the side with more room', () => {
    const trigger = triggerAt(40, 80, 160)
    const layout = layoutFixedMenu({
      trigger,
      dropdown: { width: 100, height: 900 },
      viewport,
      align: 'start',
      constrainHeight: true,
      matchTriggerWidth: true,
      minWidth: 224,
      maxWidth: 288,
    })
    expect(layout.width).toBe(224)
    expect(layout.maxHeight).toBeGreaterThanOrEqual(160)
    expect(layout.top).toBe(trigger.bottom + FIXED_MENU_GAP)
    expect(layout.left).toBe(trigger.left)
  })

  it('opens a constrained menu upward when more space is above', () => {
    const trigger = triggerAt(40, 700, 160)
    const layout = layoutFixedMenu({
      trigger,
      dropdown: { width: 200, height: 400 },
      viewport,
      align: 'start',
      constrainHeight: true,
    })
    expect(layout.maxHeight).toBeDefined()
    expect(layout.top).toBeLessThan(trigger.top)
    expect(layout.width).toBeUndefined()
  })
})
