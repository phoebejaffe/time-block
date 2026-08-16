import { describe, expect, it } from 'vitest'
import {
  defaultAnchorFromSettings,
  defaultUserSettings,
  normalizeUserSettings,
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
    })
    expect(next.defaultAnchorKind).toBe('start')
    expect(next.defaultAnchorTime).toBe('09:30')
    expect(next.defaultBlockMinutes).toBe(45)
    expect(next.timeStepMinutes).toBe(15)
    expect(next.quickUndoSeconds).toBe(0)
    expect(next.majorUndoSeconds).toBe(60)
    expect(next.executionAutoEndHours).toBe(3)
    expect(next.hiddenCalendarIds).toEqual(['a'])
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
