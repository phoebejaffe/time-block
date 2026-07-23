import { describe, expect, it } from 'vitest'
import {
  DRIVE_SCOPE,
  mergeScopeStrings,
  sessionHasDriveScope,
} from './google'

describe('mergeScopeStrings', () => {
  it('unions scopes from multiple strings', () => {
    expect(
      mergeScopeStrings(
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/calendar.events',
      ),
    ).toBe(
      'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events',
    )
  })

  it('keeps drive scope when a narrower auth response omits it', () => {
    const previous = `https://www.googleapis.com/auth/calendar.readonly ${DRIVE_SCOPE}`
    const latest = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events'
    expect(mergeScopeStrings(previous, latest)).toContain(DRIVE_SCOPE)
  })
})

describe('sessionHasDriveScope', () => {
  it('returns true when drive.appdata is granted', () => {
    expect(
      sessionHasDriveScope(
        `https://www.googleapis.com/auth/calendar.readonly ${DRIVE_SCOPE}`,
      ),
    ).toBe(true)
  })

  it('returns false for calendar-only sessions', () => {
    expect(
      sessionHasDriveScope('https://www.googleapis.com/auth/calendar.readonly'),
    ).toBe(false)
  })
})
