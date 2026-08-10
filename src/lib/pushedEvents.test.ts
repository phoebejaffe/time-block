import { describe, expect, it } from 'vitest'
import {
  canUpdateCalendar,
  hasPushedGroupOnDay,
  hasPushedTaskOnDay,
  isPushUnchanged,
  isTaskPushUnchanged,
  normalizePushedEvents,
  pickLoveEmoji,
  prunePushedEvents,
  stackPushFingerprint,
  timeblockEventDescription,
  upsertPushSnapshot,
  type PushedEvent,
} from './pushedEvents'

describe('pushedEvents', () => {
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

  it('detects updatable pushes and per-block sync state', () => {
    const events: PushedEvent[] = [
      {
        calendarId: 'cal',
        eventId: 'e1',
        taskId: 'task-a',
        groupId: 'group-1',
        dayKey: '2026-07-18',
        pushedAt: new Date().toISOString(),
      },
    ]
    expect(normalizePushedEvents(events)).toHaveLength(1)
    expect(canUpdateCalendar(events, 'cal', 'group-1', '2026-07-18')).toBe(true)
    expect(canUpdateCalendar(events, 'cal', 'group-2', '2026-07-18')).toBe(false)
    expect(canUpdateCalendar(events, 'cal', 'group-1', '2026-07-19')).toBe(false)
    expect(canUpdateCalendar(events, 'other', 'group-1', '2026-07-18')).toBe(false)
    expect(hasPushedGroupOnDay(events, 'group-1', '2026-07-18')).toBe(true)
    expect(hasPushedGroupOnDay(events, 'group-2', '2026-07-18')).toBe(false)
    expect(hasPushedGroupOnDay(events, 'group-1', '2026-07-19')).toBe(false)
    expect(hasPushedTaskOnDay(events, 'task-a', '2026-07-18')).toBe(true)
    expect(hasPushedTaskOnDay(events, 'task-b', '2026-07-18')).toBe(false)
  })

  it('detects when a pushed block still matches its snapshot', () => {
    const start = new Date('2026-07-18T15:00:00.000Z')
    const end = new Date('2026-07-18T16:00:00.000Z')
    const events: PushedEvent[] = [
      {
        calendarId: 'cal',
        eventId: 'e1',
        taskId: 't1',
        groupId: 'group-1',
        dayKey: '2026-07-18',
        pushedAt: new Date().toISOString(),
      },
    ]
    const snapshots = upsertPushSnapshot(
      [],
      'cal',
      'group-1',
      '2026-07-18',
      stackPushFingerprint(
        { kind: 'end', at: end.toISOString() },
        [{ id: 't1', title: 'Focus', start, end }],
      ),
    )
    const task = { id: 't1', title: 'Focus', start, end }
    expect(
      isTaskPushUnchanged(events, snapshots, 'group-1', '2026-07-18', task),
    ).toBe(true)
    expect(
      isTaskPushUnchanged(events, snapshots, 'group-1', '2026-07-18', {
        ...task,
        title: 'Email',
      }),
    ).toBe(false)
  })

  it('excludes empty blocks from stack fingerprint', () => {
    const start = new Date('2026-07-18T09:00:00.000Z')
    const mid = new Date('2026-07-18T09:30:00.000Z')
    const end = new Date('2026-07-18T10:00:00.000Z')
    const resolved = [
      { id: 'a', title: 'A', start, end: mid, empty: true as const },
      { id: 'b', title: 'B', start: mid, end },
    ]
    const fp = stackPushFingerprint(
      { kind: 'start', at: start.toISOString() },
      resolved,
    )
    const parsed = JSON.parse(fp) as { items: [string][] }
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]![0]).toBe('b')
  })

  it('excludes disabled blocks from stack fingerprint', () => {
    const start = new Date('2026-07-18T09:00:00.000Z')
    const mid = new Date('2026-07-18T09:30:00.000Z')
    const end = new Date('2026-07-18T10:00:00.000Z')
    const resolved = [
      { id: 'a', title: 'A', start, end: mid, disabled: true as const },
      { id: 'b', title: 'B', start: mid, end },
    ]
    const fp = stackPushFingerprint(
      { kind: 'start', at: start.toISOString() },
      resolved,
    )
    const parsed = JSON.parse(fp) as { items: [string][] }
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]![0]).toBe('b')
  })

  it('disables update when the stack fingerprint matches the last push', () => {
    const start = new Date('2026-07-18T15:00:00.000Z')
    const end = new Date('2026-07-18T16:00:00.000Z')
    const fingerprint = stackPushFingerprint(
      { kind: 'end', at: end.toISOString() },
      [{ id: 't1', title: 'Focus', start, end }],
    )
    const snapshots = upsertPushSnapshot(
      [],
      'cal',
      'group-1',
      '2026-07-18',
      fingerprint,
    )
    expect(isPushUnchanged(snapshots, 'cal', 'group-1', '2026-07-18', fingerprint)).toBe(
      true,
    )
    expect(
      isPushUnchanged(snapshots, 'cal', 'group-1', '2026-07-18', fingerprint + '!'),
    ).toBe(false)
    expect(isPushUnchanged(snapshots, 'other', 'group-1', '2026-07-18', fingerprint)).toBe(
      false,
    )
  })

  it('keeps independent snapshots per calendar on the same group/day', () => {
    const snapshots = upsertPushSnapshot(
      upsertPushSnapshot([], 'cal-a', 'group-1', '2026-07-18', 'fp-a'),
      'cal-b',
      'group-1',
      '2026-07-18',
      'fp-b',
    )
    expect(snapshots).toHaveLength(2)
    expect(isPushUnchanged(snapshots, 'cal-a', 'group-1', '2026-07-18', 'fp-a')).toBe(
      true,
    )
    expect(isPushUnchanged(snapshots, 'cal-b', 'group-1', '2026-07-18', 'fp-b')).toBe(
      true,
    )
  })

  it('stamps calendar events with a default love emoji for most users', () => {
    expect(timeblockEventDescription(null)).toBe(
      'Added via Timeblock, with love ❤️',
    )
    expect(timeblockEventDescription('some-other-uid')).toBe(
      'Added via Timeblock, with love ❤️',
    )
    expect(pickLoveEmoji(undefined)).toBe('❤️')
  })

  it('picks from the special emoji pool for allowlisted Firebase UIDs', () => {
    const uid = 'U3gTVL0CZJXNKCbtepijZfKbIE82'
    const pool =
      '❤️❤️❤️❤️❤️🩷❤️‍🔥❣️💞💖💘💝💌🌹🥂🍾🌷✨🍲🍜🍵🌱🪴🪺🎶🌈🕊️🦢🐈🐝🦋🐣🐣🐣🐣🐣'
    const graphemes = [
      ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
        pool,
      ),
    ].map((s) => s.segment)
    const prefix = 'Added via Timeblock, with love '
    const seen = new Set<string>()
    for (let i = 0; i < 300; i++) {
      const desc = timeblockEventDescription(uid)
      expect(desc.startsWith(prefix)).toBe(true)
      const emoji = desc.slice(prefix.length)
      expect(graphemes).toContain(emoji)
      seen.add(emoji)
    }
    expect(seen.size).toBeGreaterThan(1)
  })
})
