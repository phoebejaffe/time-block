import { describe, expect, it } from 'vitest'
import {
  cloneCalendarGuests,
  guestChipLabel,
  guestEmailKey,
  isValidEmail,
  normalizeCalendarGuests,
  normalizeSavedCalendarUsers,
} from './savedCalendarUsers'

describe('saved calendar users', () => {
  it('accepts a simple email and rejects junk', () => {
    expect(isValidEmail('Ada@Example.com')).toBe(true)
    expect(isValidEmail('  ada@example.com  ')).toBe(true)
    expect(isValidEmail('nope')).toBe(false)
    expect(isValidEmail('a@b')).toBe(false)
  })

  it('normalizes users, dropping invalid and duplicate emails', () => {
    expect(
      normalizeSavedCalendarUsers([
        { id: '1', name: ' Ada ', email: 'Ada@Example.com' },
        { id: '2', name: 'Ada 2', email: 'ada@example.com' },
        { id: '3', name: 'Skip', email: 'not-an-email' },
        { id: '4', name: 'Bob', email: 'bob@x.co' },
        { name: 'No id', email: 'c@d.com' },
      ]),
    ).toEqual([
      { id: '1', name: 'Ada', email: 'Ada@Example.com' },
      { id: '4', name: 'Bob', email: 'bob@x.co' },
    ])
    expect(normalizeSavedCalendarUsers(null)).toEqual([])
  })

  it('normalizes per-calendar guests and clones them', () => {
    const guests = normalizeCalendarGuests({
      'cal-1': [
        { email: 'Ada@Example.com', name: 'Ada' },
        { email: 'ada@example.com' },
        { email: 'nope' },
        { email: 'bob@x.co' },
      ],
      'cal-2': [],
      '': [{ email: 'x@y.com' }],
    })
    expect(guests).toEqual({
      'cal-1': [
        { email: 'Ada@Example.com', name: 'Ada' },
        { email: 'bob@x.co' },
      ],
    })
    expect(cloneCalendarGuests(guests)).toEqual(guests)
    expect(normalizeCalendarGuests(undefined)).toBeUndefined()
  })

  it('labels chips from the live address book, then stored name, then email', () => {
    const saved = [{ id: '1', name: 'Ada Lovelace', email: 'ada@example.com' }]
    expect(
      guestChipLabel({ email: 'ADA@example.com', name: 'Old' }, saved),
    ).toBe('Ada Lovelace')
    expect(guestChipLabel({ email: 'bob@x.co', name: 'Bob' }, saved)).toBe(
      'Bob',
    )
    expect(guestChipLabel({ email: 'one@off.com' }, saved)).toBe('one@off.com')
    expect(guestEmailKey(' Ada@X.com ')).toBe('ada@x.com')
  })
})
