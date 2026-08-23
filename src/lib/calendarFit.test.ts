import { describe, expect, it } from 'vitest'
import {
  CALENDAR_SLOT_MAX_MINUTES,
  CALENDAR_SLOT_MIN_MINUTES,
  CALENDAR_SLOT_MINUTES,
  FIT_ZOOM_FILL,
  calendarSlotBounds,
  clockMinutes,
  contentYForMinutes,
  easeOut,
  enabledPlansFingerprint,
  enabledPlansTimeRange,
  fitAnimFrame,
  fitScrollTop,
  planFit,
  scrollTopForSlotMinChange,
} from './calendarFit'
import { createBlockGroup, createTask } from './tasks'

function at(hours: number, minutes = 0): string {
  const d = new Date(2026, 6, 18, hours, minutes, 0, 0)
  return d.toISOString()
}

describe('easeOut', () => {
  it('is 0 at the start and 1 at the end', () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
  })

  it('decelerates (midpoint is above linear)', () => {
    expect(easeOut(0.5)).toBe(0.75)
  })
})

describe('fitAnimFrame', () => {
  it('is a no-op at t=0 and lands on the target at t=1', () => {
    expect(fitAnimFrame(0, 2, 1, 400, 100)).toEqual({
      zoom: 2,
      scrollTop: 400,
    })
    expect(fitAnimFrame(1, 2, 1, 400, 100)).toEqual({
      zoom: 1,
      scrollTop: 100,
    })
  })

  it('lerps scroll in content space while zoom changes', () => {
    const mid = fitAnimFrame(0.5, 2, 1, 400, 100)
    expect(mid.zoom).toBe(1.5)
    // contentFrom = 200, contentTo = 100 → 150 * 1.5 zoom
    expect(mid.scrollTop).toBe(225)
  })

  it('lerps scroll linearly when zoom is unchanged', () => {
    expect(fitAnimFrame(0.5, 1, 1, 0, 200)).toEqual({
      zoom: 1,
      scrollTop: 100,
    })
  })
})

describe('enabledPlansTimeRange', () => {
  it('returns null when nothing enabled occupies time', () => {
    expect(enabledPlansTimeRange([])).toBeNull()
    expect(
      enabledPlansTimeRange([
        createBlockGroup({ enabled: false, tasks: [createTask({ title: 'A', durationMinutes: 30 })] }),
      ]),
    ).toBeNull()
    expect(
      enabledPlansTimeRange([
        createBlockGroup({
          tasks: [createTask({ title: 'Skip', durationMinutes: 30, disabled: true })],
        }),
      ]),
    ).toBeNull()
  })

  it('unions enabled stacks and ignores a disabled group', () => {
    const morning = createBlockGroup({
      id: 'am',
      tasks: [createTask({ title: 'Wake', durationMinutes: 60 })],
      anchor: { kind: 'start', at: at(8) },
    })
    const evening = createBlockGroup({
      id: 'pm',
      tasks: [createTask({ title: 'Cook', durationMinutes: 45 })],
      anchor: { kind: 'start', at: at(18) },
    })
    const hidden = createBlockGroup({
      id: 'hid',
      enabled: false,
      tasks: [createTask({ title: 'Hidden', durationMinutes: 120 })],
      anchor: { kind: 'start', at: at(12) },
    })
    const range = enabledPlansTimeRange([morning, evening, hidden])
    expect(range).not.toBeNull()
    expect(range!.startMinutes).toBeCloseTo(8 * 60)
    expect(range!.endMinutes).toBeCloseTo(18 * 60 + 45)
  })

  it('keeps backward stacks relative to the anchor day', () => {
    const group = createBlockGroup({
      tasks: [createTask({ title: 'Late', durationMinutes: 120 })],
      anchor: { kind: 'end', at: at(1) },
    })
    const range = enabledPlansTimeRange([group])
    expect(range).not.toBeNull()
    expect(range!.startMinutes).toBe(-60)
    expect(range!.endMinutes).toBe(60)
    expect(calendarSlotBounds(range)).toEqual({
      minMinutes: -60,
      maxMinutes: 24 * 60,
    })
  })

  it('limits adjacent-day slots to one day', () => {
    expect(
      calendarSlotBounds({ startMinutes: -2000, endMinutes: 3500 }),
    ).toEqual({ minMinutes: -24 * 60, maxMinutes: 48 * 60 })
  })

  it('fingerprint changes when a group is enabled or the stack moves', () => {
    const group = createBlockGroup({
      id: 'g1',
      tasks: [createTask({ title: 'A', durationMinutes: 30 })],
      anchor: { kind: 'start', at: at(9) },
    })
    const a = enabledPlansFingerprint([group])
    const b = enabledPlansFingerprint([{ ...group, enabled: false }])
    const c = enabledPlansFingerprint([
      { ...group, anchor: { kind: 'start', at: at(10) } },
    ])
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
    expect(enabledPlansFingerprint([group])).toBe(a)
  })

  it('fingerprint ignores title-only edits', () => {
    const group = createBlockGroup({
      id: 'g1',
      tasks: [createTask({ title: 'A', durationMinutes: 30 })],
      anchor: { kind: 'start', at: at(9) },
    })
    const renamed = {
      ...group,
      tasks: [{ ...group.tasks[0]!, title: 'B' }],
    }
    expect(enabledPlansFingerprint([renamed])).toBe(
      enabledPlansFingerprint([group]),
    )
  })
})

describe('scrollTopForSlotMinChange', () => {
  it('keeps the same clock time visible when earlier slots are prepended', () => {
    expect(scrollTopForSlotMinChange(480, 0, -60, 15, 20, 20)).toBe(560)
  })

  it('accounts for a simultaneous slot-height change', () => {
    expect(scrollTopForSlotMinChange(480, 0, -60, 15, 20, 10)).toBe(280)
  })
})

describe('contentYForMinutes / fitScrollTop', () => {
  const slotH = 20

  it('maps midnight to y=0 and each 15 minutes to one slot', () => {
    expect(
      contentYForMinutes(
        0,
        CALENDAR_SLOT_MIN_MINUTES,
        CALENDAR_SLOT_MAX_MINUTES,
        CALENDAR_SLOT_MINUTES,
        slotH,
      ),
    ).toBe(0)
    expect(
      contentYForMinutes(
        6 * 60,
        CALENDAR_SLOT_MIN_MINUTES,
        CALENDAR_SLOT_MAX_MINUTES,
        CALENDAR_SLOT_MINUTES,
        slotH,
      ),
    ).toBe(24 * slotH)
  })

  it('is a no-op when the range is already fully visible', () => {
    expect(fitScrollTop(100, 400, 120, 300)).toBeNull()
    // even if shifting would also show a fittable now bar
    expect(fitScrollTop(0, 200, 50, 100, 240)).toBeNull()
  })

  it('centers a range that is off-screen', () => {
    // range 50–150 in a 200px view → extra 100 → scrollTop 0
    expect(fitScrollTop(400, 200, 50, 150)).toBe(0)
    // range 250–350 → extra 100 → scrollTop 200
    expect(fitScrollTop(0, 200, 250, 350)).toBe(200)
  })

  it('parks extra space on the now-bar side when now can fit', () => {
    // now above (y=10), plans 100–180, view 200: union fits → plans at bottom
    expect(fitScrollTop(400, 200, 100, 180, 10)).toBe(-20)
    // now below (y=240), plans 50–100, view 200: union fits → plans at top
    expect(fitScrollTop(400, 200, 50, 100, 240)).toBe(50)
  })

  it('centers when now sits inside the range', () => {
    expect(fitScrollTop(400, 200, 50, 150, 100)).toBe(0)
  })

  it('centers when now cannot share the viewport', () => {
    // plans 0–80, now at 400, view 200: union 400px > 200
    expect(fitScrollTop(300, 200, 0, 80, 400)).toBe(-60)
  })

  it('parks an oversized range at its start', () => {
    expect(fitScrollTop(80, 200, 0, 800)).toBe(0)
    expect(fitScrollTop(0, 200, 0, 800)).toBeNull()
  })
})

describe('planFit', () => {
  const base = {
    startMinutes: 9 * 60,
    endMinutes: 10 * 60,
    slotMinMinutes: CALENDAR_SLOT_MIN_MINUTES,
    slotMaxMinutes: CALENDAR_SLOT_MAX_MINUTES,
    slotMinutes: CALENDAR_SLOT_MINUTES,
    slotHeight: 20,
    scrollTop: 0,
    viewHeight: 400,
    zoom: 1,
    minZoom: 0.95,
    paddingPx: 16,
  }

  it('does nothing when the stack is already on screen', () => {
    // Keep scrollTop covering the occupied range plus padding.
    const startY = contentYForMinutes(
      9 * 60,
      base.slotMinMinutes,
      base.slotMaxMinutes,
      base.slotMinutes,
      20,
    )
    expect(
      planFit({
        ...base,
        scrollTop: startY - 20,
        viewHeight: 300,
      }),
    ).toEqual({ kind: 'visible' })
  })

  it('scrolls when the stack is below the view and still fits', () => {
    const result = planFit({ ...base, scrollTop: 0, viewHeight: 200 })
    expect(result.kind).toBe('scroll')
    if (result.kind === 'scroll') {
      expect(result.scrollTop).toBeGreaterThan(0)
    }
  })

  it('zooms out until the stack fills 90% of the view', () => {
    const result = planFit({
      ...base,
      startMinutes: 9 * 60,
      endMinutes: 15 * 60,
      viewHeight: 400,
      zoom: 2,
      minZoom: 0.95,
    })
    expect(result.kind).toBe('zoom')
    if (result.kind === 'zoom') {
      const top =
        contentYForMinutes(
          9 * 60,
          base.slotMinMinutes,
          base.slotMaxMinutes,
          base.slotMinutes,
          20,
        ) - 16
      const bot =
        contentYForMinutes(
          15 * 60,
          base.slotMinMinutes,
          base.slotMaxMinutes,
          base.slotMinutes,
          20,
        ) + 16
      const expected = 2 * ((400 * FIT_ZOOM_FILL) / (bot - top))
      expect(result.zoom).toBeCloseTo(expected)
      expect(result.zoom).toBeGreaterThanOrEqual(0.95)
    }
  })

  it('stops at min zoom when 90% fill would go smaller', () => {
    const result = planFit({
      ...base,
      startMinutes: 6 * 60,
      endMinutes: 22 * 60,
      viewHeight: 200,
      zoom: 2,
      minZoom: 0.95,
    })
    expect(result.kind).toBe('zoom')
    if (result.kind === 'zoom') {
      expect(result.zoom).toBe(0.95)
    }
  })

  it('never zooms in', () => {
    const result = planFit({
      ...base,
      startMinutes: 9 * 60,
      endMinutes: 9 * 60 + 15,
      zoom: 1.2,
      viewHeight: 800,
    })
    expect(result.kind).not.toBe('zoom')
  })

  it('centers the stack when now is far away', () => {
    const result = planFit({
      ...base,
      scrollTop: 0,
      viewHeight: 200,
      nowMinutes: 22 * 60,
    })
    expect(result.kind).toBe('scroll')
    if (result.kind === 'scroll') {
      const top =
        contentYForMinutes(
          9 * 60,
          base.slotMinMinutes,
          base.slotMaxMinutes,
          base.slotMinutes,
          20,
        ) - 16
      const bot =
        contentYForMinutes(
          10 * 60,
          base.slotMinMinutes,
          base.slotMaxMinutes,
          base.slotMinutes,
          20,
        ) + 16
      expect(result.scrollTop).toBeCloseTo(top - (200 - (bot - top)) / 2)
    }
  })

  it('keeps extra space on the now side when the now bar can fit', () => {
    const result = planFit({
      ...base,
      startMinutes: 8 * 60,
      endMinutes: 8 * 60 + 30,
      scrollTop: 900,
      viewHeight: 400,
      nowMinutes: 12 * 60,
    })
    expect(result.kind).toBe('scroll')
    if (result.kind === 'scroll') {
      const top =
        contentYForMinutes(
          8 * 60,
          base.slotMinMinutes,
          base.slotMaxMinutes,
          base.slotMinutes,
          20,
        ) - 16
      expect(result.scrollTop).toBeCloseTo(Math.max(0, top))
    }
  })
})

describe('clockMinutes', () => {
  it('reads the local clock', () => {
    expect(clockMinutes(new Date(2026, 6, 18, 14, 30, 0, 0))).toBe(14 * 60 + 30)
  })
})
