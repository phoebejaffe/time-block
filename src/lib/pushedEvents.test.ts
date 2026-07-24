import { describe, expect, it } from 'vitest'
import {
  canUpdateCalendar,
  hasPushedGroupOnDay,
  hasPushedTaskOnDay,
  isPushUnchanged,
  isTaskPushUnchanged,
  normalizePushedEvents,
  prunePushedEvents,
  stackPushFingerprint,
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
})
