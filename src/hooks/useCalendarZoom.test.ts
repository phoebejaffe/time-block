import { describe, expect, it } from 'vitest'
import { anchoredScrollTop } from './useCalendarZoom'

describe('anchoredScrollTop', () => {
  it('scales scroll when the pointer is at the top of the scroller', () => {
    // contentY = 200; after 2× zoom that content is at 400 → scrollTop 400
    expect(anchoredScrollTop(200, 100, 100, 1, 2)).toBe(400)
  })

  it('keeps the content under the pointer fixed when zooming in', () => {
    const scrollTop = 100
    const scrollerTop = 50
    const clientY = 200 // offsetY = 150; contentY = 250
    const next = anchoredScrollTop(scrollTop, clientY, scrollerTop, 1, 2)
    // Under the pointer after zoom: next + 150 should equal 250 * 2
    expect(next + (clientY - scrollerTop)).toBe(500)
    expect(next).toBe(350)
  })

  it('keeps the content under the pointer fixed when zooming out', () => {
    const scrollTop = 350
    const scrollerTop = 50
    const clientY = 200
    const next = anchoredScrollTop(scrollTop, clientY, scrollerTop, 2, 1)
    expect(next + (clientY - scrollerTop)).toBe(250)
    expect(next).toBe(100)
  })

  it('is a no-op when zoom is unchanged', () => {
    expect(anchoredScrollTop(120, 80, 10, 1.5, 1.5)).toBe(120)
  })
})
