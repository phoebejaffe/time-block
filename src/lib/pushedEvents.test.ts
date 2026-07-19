import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  canUpdateCalendar,
  isPushUnchanged,
  loadPushedEvents,
  prunePushedEvents,
  savePushedEvents,
  savePushSnapshot,
  stackPushFingerprint,
  type PushedEvent,
} from './pushedEvents'

function mockStorage() {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => {
        store.clear()
      },
    },
  })
  return store
}

describe('pushedEvents', () => {
  beforeEach(() => {
    mockStorage()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('prunes events older than about a month', () => {
    const now = Date.parse('2026-07-18T12:00:00.000Z')
    const events: PushedEvent[] = [
      {
        calendarId: 'cal',
        eventId: 'old',
        taskId: 't1',
        groupId: 'g1',
        dayKey: '2026-06-01',
        pushedAt: '2026-06-01T12:00:00.000Z',
      },
      {
        calendarId: 'cal',
        eventId: 'new',
        taskId: 't2',
        groupId: 'g1',
        dayKey: '2026-07-10',
        pushedAt: '2026-07-10T12:00:00.000Z',
      },
    ]
    const kept = prunePushedEvents(events, now)
    expect(kept.map((e) => e.eventId)).toEqual(['new'])
  })

  it('round-trips through localStorage and detects updatable pushes', () => {
    savePushedEvents([
      {
        calendarId: 'cal',
        eventId: 'e1',
        taskId: 'task-a',
        groupId: 'group-1',
        dayKey: '2026-07-18',
        pushedAt: new Date().toISOString(),
      },
    ])
    expect(loadPushedEvents()).toHaveLength(1)
    expect(canUpdateCalendar('cal', 'group-1', '2026-07-18')).toBe(true)
    expect(canUpdateCalendar('cal', 'group-2', '2026-07-18')).toBe(false)
    expect(canUpdateCalendar('cal', 'group-1', '2026-07-19')).toBe(false)
    expect(canUpdateCalendar('other', 'group-1', '2026-07-18')).toBe(false)
  })

  it('disables update when the stack fingerprint matches the last push', () => {
    const start = new Date('2026-07-18T15:00:00.000Z')
    const end = new Date('2026-07-18T16:00:00.000Z')
    const fingerprint = stackPushFingerprint(
      { kind: 'end', at: end.toISOString() },
      [{ id: 't1', title: 'Focus', start, end }],
    )
    savePushSnapshot('cal', 'group-1', '2026-07-18', fingerprint)
    expect(isPushUnchanged('cal', 'group-1', '2026-07-18', fingerprint)).toBe(
      true,
    )
    expect(
      isPushUnchanged('cal', 'group-1', '2026-07-18', fingerprint + '!'),
    ).toBe(false)
    expect(isPushUnchanged('other', 'group-1', '2026-07-18', fingerprint)).toBe(
      false,
    )
  })
})
