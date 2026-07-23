import { describe, expect, it } from 'vitest'
import { mergeScopeStrings } from './google'

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

  it('keeps earlier scopes when a narrower auth response omits them', () => {
    const previous =
      'https://www.googleapis.com/auth/calendar.readonly openid email profile'
    const latest =
      'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events'
    const merged = mergeScopeStrings(previous, latest)
    expect(merged).toContain('openid')
    expect(merged).toContain('calendar.events')
  })
})
