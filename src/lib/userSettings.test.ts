import { describe, expect, it } from 'vitest'
import {
  defaultAnchorFromSettings,
  defaultUserSettings,
  googleDefaultVisibleCalendarIds,
  normalizeUserSettings,
  pruneVisibleCalendarIds,
  sameCalendarIdSet,
} from './userSettings'

describe('normalizeUserSettings', () => {
  it('returns defaults for junk', () => {
    expect(normalizeUserSettings(null)).toEqual(defaultUserSettings())
    expect(normalizeUserSettings({})).toEqual(defaultUserSettings())
  })

  it('clamps and normalizes fields', () => {
    const next = normalizeUserSettings({
      defaultAnchorKind: 'start',
      defaultAnchorTime: '9:30',
      defaultBlockMinutes: 45,
      timeStepMinutes: 15,
      quickUndoSeconds: 0,
      majorUndoSeconds: 60,
      executionAutoEndHours: 3,
      hiddenCalendarIds: ['a', 'a', '', 1],
      visibleCalendarIds: ['x', 'x', '', 2],
    })
    expect(next.defaultAnchorKind).toBe('start')
    expect(next.defaultAnchorTime).toBe('09:30')
    expect(next.defaultBlockMinutes).toBe(45)
    expect(next.timeStepMinutes).toBe(15)
    expect(next.quickUndoSeconds).toBe(0)
    expect(next.majorUndoSeconds).toBe(60)
    expect(next.executionAutoEndHours).toBe(3)
    expect(next.hiddenCalendarIds).toEqual(['a'])
    expect(next.visibleCalendarIds).toEqual(['x'])
  })

  it('treats missing visible calendars as unset, not none', () => {
    expect(normalizeUserSettings({}).visibleCalendarIds).toBeUndefined()
    expect(
      normalizeUserSettings({ visibleCalendarIds: [] }).visibleCalendarIds,
    ).toEqual([])
  })

  it('accepts 1- and 2-minute time steps', () => {
    expect(normalizeUserSettings({ timeStepMinutes: 1 }).timeStepMinutes).toBe(1)
    expect(normalizeUserSettings({ timeStepMinutes: 2 }).timeStepMinutes).toBe(2)
    expect(normalizeUserSettings({ timeStepMinutes: 7 }).timeStepMinutes).toBe(5)
  })
})

describe('defaultAnchorFromSettings', () => {
  it('uses kind and clock time', () => {
    const settings = {
      ...defaultUserSettings(),
      defaultAnchorKind: 'start' as const,
      defaultAnchorTime: '14:15',
    }
    const anchor = defaultAnchorFromSettings(settings)
    expect(anchor.kind).toBe('start')
    const d = new Date(anchor.at)
    expect(d.getHours()).toBe(14)
    expect(d.getMinutes()).toBe(15)
  })
})

describe('visible calendar ids', () => {
  it('defaults to Google selected/primary, else the first calendar', () => {
    expect(
      googleDefaultVisibleCalendarIds([
        { id: 'a' },
        { id: 'b', selected: true },
        { id: 'c', primary: true },
      ]),
    ).toEqual(['b', 'c'])
    expect(googleDefaultVisibleCalendarIds([{ id: 'only' }])).toEqual(['only'])
    expect(googleDefaultVisibleCalendarIds([])).toEqual([])
  })

  it('prunes ids that are no longer in the calendar list', () => {
    expect(pruneVisibleCalendarIds(undefined, ['a'])).toBeUndefined()
    expect(pruneVisibleCalendarIds(['a', 'gone', 'b'], ['b', 'a'])).toEqual([
      'a',
      'b',
    ])
    expect(pruneVisibleCalendarIds([], ['a'])).toEqual([])
  })

  it('compares calendar id sets without regard to order', () => {
    expect(sameCalendarIdSet(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameCalendarIdSet(['a'], ['a', 'b'])).toBe(false)
  })
})
