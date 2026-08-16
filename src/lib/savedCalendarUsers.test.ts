import { describe, expect, it } from 'vitest'
import {
  cloneCalendarGuests,
  guestChipLabel,
  guestEmailKey,
  isValidEmail,
  mergeCalendarGuests,
  normalizeCalendarGuests,
  normalizeSavedCalendarUsers,
  partitionGuests,
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

describe('mergeCalendarGuests', () => {
  it('adds a calendar without touching others', () => {
    expect(
      mergeCalendarGuests(
        { 'cal-a': [{ email: 'ada@example.com', name: 'Ada' }] },
        { 'cal-b': [{ email: 'bob@example.com' }] },
      ),
    ).toEqual({
      'cal-a': [{ email: 'ada@example.com', name: 'Ada' }],
      'cal-b': [{ email: 'bob@example.com' }],
    })
  })

  it('deletes a calendar key when the patch list is empty', () => {
    expect(
      mergeCalendarGuests(
        {
          'cal-a': [{ email: 'ada@example.com' }],
          'cal-b': [{ email: 'bob@example.com' }],
        },
        { 'cal-a': [] },
      ),
    ).toEqual({
      'cal-b': [{ email: 'bob@example.com' }],
    })
  })

  it('drops calendarGuests entirely when the last calendar is cleared', () => {
    expect(
      mergeCalendarGuests(
        { 'cal-a': [{ email: 'ada@example.com' }] },
        { 'cal-a': [] },
      ),
    ).toBeUndefined()
    expect(mergeCalendarGuests(undefined, { 'cal-a': [] })).toBeUndefined()
  })

  it('trims names and omits blank ones', () => {
    expect(
      mergeCalendarGuests(undefined, {
        'cal-a': [
          { email: 'ada@example.com', name: ' Ada ' },
          { email: 'bob@example.com', name: '   ' },
        ],
      }),
    ).toEqual({
      'cal-a': [
        { email: 'ada@example.com', name: 'Ada' },
        { email: 'bob@example.com' },
      ],
    })
  })
})

describe('partitionGuests', () => {
  const ada = { email: 'ada@example.com', name: 'Ada' }
  const bob = { email: 'bob@example.com' }

  it('treats last-successful guests as Invited and new ones as Inviting', () => {
    expect(partitionGuests([ada, bob], [ada])).toEqual({
      invited: [ada],
      inviting: [bob],
    })
  })

  it('matches Invited by email case-insensitively', () => {
    expect(
      partitionGuests([{ email: 'ADA@example.com', name: 'Ada' }], [ada]),
    ).toEqual({
      invited: [{ email: 'ADA@example.com', name: 'Ada' }],
      inviting: [],
    })
  })

  it('omits a removed Invited person from both lists', () => {
    expect(partitionGuests([], [ada, bob])).toEqual({
      invited: [],
      inviting: [],
    })
    expect(partitionGuests([bob], [ada, bob])).toEqual({
      invited: [bob],
      inviting: [],
    })
  })

  it('keeps a re-added snapshot guest as Invited', () => {
    expect(partitionGuests([ada], [ada])).toEqual({
      invited: [ada],
      inviting: [],
    })
  })
})
