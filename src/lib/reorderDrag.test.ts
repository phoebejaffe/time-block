import { describe, expect, it } from 'vitest'
import { getReorderAutoScrollDelta } from './reorderDrag'

describe('getReorderAutoScrollDelta', () => {
  it('does not scroll away from the container edges', () => {
    expect(getReorderAutoScrollDelta(300, 100, 700)).toBe(0)
  })

  it('scrolls upward with increasing speed near the top edge', () => {
    expect(getReorderAutoScrollDelta(172, 100, 700)).toBe(0)
    expect(getReorderAutoScrollDelta(136, 100, 700)).toBe(-4)
    expect(getReorderAutoScrollDelta(0, 100, 700)).toBe(-8)
  })

  it('scrolls downward with increasing speed near the bottom edge', () => {
    expect(getReorderAutoScrollDelta(628, 100, 700)).toBe(0)
    expect(getReorderAutoScrollDelta(664, 100, 700)).toBe(4)
    expect(getReorderAutoScrollDelta(900, 100, 700)).toBe(8)
  })
})
