import { beforeEach, describe, expect, it } from 'vitest'
import {
  deleteGroupFromCalendar,
  syncGroupToCalendars,
  syncTasksToCalendar,
} from './calendarApi'
import type { Task } from './tasks'

type FakeEvent = {
  id: string
  summary: string
  start: string
  end: string
  description?: string
  attendees?: { email: string; displayName?: string }[]
}

function mockGapiCalendar(options?: { failInsertOn?: string[] }) {
  const failInsertOn = new Set(options?.failInsertOn ?? [])
  const store = new Map<string, FakeEvent>()
  let nextId = 1
  const calls: Array<{
    method: 'insert' | 'update' | 'delete'
    calendarId?: string
    sendUpdates?: string
    attendees?: { email: string; displayName?: string }[]
  }> = []

  const events = {
    get: async ({ eventId }: { calendarId: string; eventId: string }) => {
      const event = store.get(eventId)
      if (!event) {
        const err = { status: 404 }
        throw err
      }
      return {
        result: {
          id: event.id,
          status: 'confirmed',
          summary: event.summary,
          start: { dateTime: event.start },
          end: { dateTime: event.end },
          attendees: event.attendees,
        },
      }
    },
    update: async ({
      calendarId,
      eventId,
      sendUpdates,
      resource,
    }: {
      calendarId: string
      eventId: string
      sendUpdates?: string
      resource: {
        summary?: string
        description?: string
        start?: { dateTime?: string }
        end?: { dateTime?: string }
        attendees?: { email: string; displayName?: string }[]
      }
    }) => {
      const event = store.get(eventId)
      if (!event) throw { status: 404 }
      calls.push({
        method: 'update',
        calendarId,
        sendUpdates,
        attendees: resource.attendees,
      })
      store.set(eventId, {
        ...event,
        summary: resource.summary ?? event.summary,
        description: resource.description ?? event.description,
        start: resource.start?.dateTime ?? event.start,
        end: resource.end?.dateTime ?? event.end,
        attendees: resource.attendees ?? event.attendees,
      })
      return { result: { id: eventId } }
    },
    insert: async ({
      calendarId,
      sendUpdates,
      resource,
    }: {
      calendarId: string
      sendUpdates?: string
      resource: {
        summary?: string
        description?: string
        start?: { dateTime?: string }
        end?: { dateTime?: string }
        attendees?: { email: string; displayName?: string }[]
      }
    }) => {
      if (failInsertOn.has(calendarId)) {
        throw { message: 'quota exceeded' }
      }
      const id = `evt-${nextId++}`
      calls.push({
        method: 'insert',
        calendarId,
        sendUpdates,
        attendees: resource.attendees,
      })
      store.set(id, {
        id,
        summary: resource.summary ?? '',
        description: resource.description,
        start: resource.start?.dateTime ?? '',
        end: resource.end?.dateTime ?? '',
        attendees: resource.attendees,
      })
      return { result: { id } }
    },
    delete: async ({
      calendarId,
      eventId,
      sendUpdates,
    }: {
      calendarId: string
      eventId: string
      sendUpdates?: string
    }) => {
      calls.push({ method: 'delete', calendarId, sendUpdates })
      store.delete(eventId)
    },
  }

  ;(globalThis as unknown as { gapi: unknown }).gapi = {
    client: { calendar: { events } },
  }

  return { store, calls }
}

describe('syncTasksToCalendar — per-day isolation', () => {
  beforeEach(() => {
    mockGapiCalendar()
  })

  const tasks: Task[] = [
    { id: 't1', title: 'Focus', durationMinutes: 60 },
  ]

  it('pushing the same group to a different day creates new events instead of moving the old ones', async () => {
    const day1Anchor = {
      kind: 'start' as const,
      at: new Date('2026-07-23T15:00:00.000Z').toISOString(),
    }
    const day2Anchor = {
      kind: 'start' as const,
      at: new Date('2026-07-24T15:00:00.000Z').toISOString(),
    }

    const first = await syncTasksToCalendar(
      'cal-1',
      'group-1',
      tasks,
      day1Anchor,
      [],
    )
    expect(first.created).toBe(1)
    expect(first.updated).toBe(0)
    expect(first.pushedEvents).toHaveLength(1)
    const day1Event = first.pushedEvents[0]!
    expect(day1Event.dayKey).toBe('2026-07-23')

    const second = await syncTasksToCalendar(
      'cal-1',
      'group-1',
      tasks,
      day2Anchor,
      first.pushedEvents,
    )

    // Must create a brand new event for the new day, not patch the old one.
    expect(second.created).toBe(1)
    expect(second.updated).toBe(0)
    expect(second.pushedEvents).toHaveLength(2)

    const day1Tracked = second.pushedEvents.find((e) => e.dayKey === '2026-07-23')
    const day2Tracked = second.pushedEvents.find((e) => e.dayKey === '2026-07-24')
    expect(day1Tracked).toBeTruthy()
    expect(day2Tracked).toBeTruthy()
    expect(day1Tracked!.eventId).not.toBe(day2Tracked!.eventId)
  })

  it('writes and tracks a Google event that crosses midnight', async () => {
    const { store } = mockGapiCalendar()
    const anchorAt = new Date(2026, 6, 23, 23, 0, 0)
    const endAt = new Date(2026, 6, 24, 1, 0, 0)
    const anchor = {
      kind: 'start' as const,
      at: anchorAt.toISOString(),
    }
    const result = await syncTasksToCalendar(
      'cal-1',
      'group-1',
      [{ id: 't1', title: 'Late focus', durationMinutes: 120 }],
      anchor,
      [],
    )

    expect(result.created).toBe(1)
    expect(result.pushedEvents).toMatchObject([
      {
        calendarId: 'cal-1',
        groupId: 'group-1',
        taskId: 't1',
        dayKey: '2026-07-23',
      },
    ])
    const event = [...store.values()].at(0)
    expect(event).toMatchObject({
      start: anchorAt.toISOString(),
      end: endAt.toISOString(),
    })
  })

  it('pushes an end-anchored occurrence that starts the previous day', async () => {
    const { store } = mockGapiCalendar()
    const endAt = new Date(2026, 6, 24, 1, 0, 0)
    const result = await syncTasksToCalendar(
      'cal-1',
      'group-1',
      [{ id: 't1', title: 'Early focus', durationMinutes: 120 }],
      { kind: 'end', at: endAt.toISOString() },
      [],
    )

    expect(result.pushedEvents[0]).toMatchObject({ dayKey: '2026-07-24' })
    expect([...store.values()][0]).toMatchObject({
      start: new Date(2026, 6, 23, 23, 0, 0).toISOString(),
      end: endAt.toISOString(),
    })
  })

  it('updates and deletes the same spillover occurrence', async () => {
    const { store } = mockGapiCalendar()
    const anchorAt = new Date(2026, 6, 23, 23, 0, 0)
    const anchor = { kind: 'start' as const, at: anchorAt.toISOString() }
    const first = await syncTasksToCalendar(
      'cal-1',
      'group-1',
      [{ id: 't1', title: 'Late focus', durationMinutes: 120 }],
      anchor,
      [],
    )
    const eventId = first.pushedEvents[0]!.eventId

    const updated = await syncTasksToCalendar(
      'cal-1',
      'group-1',
      [{ id: 't1', title: 'Late focus updated', durationMinutes: 90 }],
      anchor,
      first.pushedEvents,
    )
    expect(updated.updated).toBe(1)
    expect(updated.created).toBe(0)
    expect(updated.pushedEvents[0]!.eventId).toBe(eventId)
    expect(store.get(eventId)).toMatchObject({
      summary: 'Late focus updated',
      end: new Date(2026, 6, 24, 0, 30, 0).toISOString(),
    })

    const deleted = await deleteGroupFromCalendar(
      'group-1',
      '2026-07-23',
      updated.pushedEvents,
    )
    expect(deleted.removed).toBe(1)
    expect(deleted.pushedEvents).toEqual([])
    expect(store.has(eventId)).toBe(false)
  })

  it('updating one day does not touch the calendar event on another day', async () => {
    const day1Anchor = {
      kind: 'start' as const,
      at: new Date('2026-07-23T15:00:00.000Z').toISOString(),
    }
    const day2Anchor = {
      kind: 'start' as const,
      at: new Date('2026-07-24T15:00:00.000Z').toISOString(),
    }

    const afterDay1 = await syncTasksToCalendar(
      'cal-1',
      'group-1',
      tasks,
      day1Anchor,
      [],
    )
    const afterDay2 = await syncTasksToCalendar(
      'cal-1',
      'group-1',
      tasks,
      day2Anchor,
      afterDay1.pushedEvents,
    )

    const day1EventIdBefore = afterDay2.pushedEvents.find(
      (e) => e.dayKey === '2026-07-23',
    )!.eventId

    // Update the day-1 stack again (e.g. edited duration) — day 2 must be untouched.
    const updatedTasks: Task[] = [
      { id: 't1', title: 'Focus (renamed)', durationMinutes: 90 },
    ]
    const afterUpdateDay1 = await syncTasksToCalendar(
      'cal-1',
      'group-1',
      updatedTasks,
      day1Anchor,
      afterDay2.pushedEvents,
    )

    expect(afterUpdateDay1.updated).toBe(1)
    expect(afterUpdateDay1.created).toBe(0)

    const day1EventAfter = afterUpdateDay1.pushedEvents.find(
      (e) => e.dayKey === '2026-07-23',
    )!
    const day2EventAfter = afterUpdateDay1.pushedEvents.find(
      (e) => e.dayKey === '2026-07-24',
    )!

    // Same event id reused for day 1 (an in-place update), day 2 unaffected.
    expect(day1EventAfter.eventId).toBe(day1EventIdBefore)
    expect(day2EventAfter.eventId).toBe(
      afterDay2.pushedEvents.find((e) => e.dayKey === '2026-07-24')!.eventId,
    )
  })

  it('skips empty blocks and removes previously pushed events when a block becomes empty', async () => {
    const anchor = {
      kind: 'start' as const,
      at: new Date('2026-07-23T15:00:00.000Z').toISOString(),
    }

    const normalTasks: Task[] = [{ id: 't1', title: 'Focus', durationMinutes: 60 }]
    const first = await syncTasksToCalendar(
      'cal-1',
      'group-1',
      normalTasks,
      anchor,
      [],
    )
    expect(first.created).toBe(1)
    expect(first.pushedEvents).toHaveLength(1)

    const withEmpty: Task[] = [
      { id: 't1', title: 'Focus', durationMinutes: 60, empty: true },
      { id: 't2', title: 'Next', durationMinutes: 30 },
    ]
    const second = await syncTasksToCalendar(
      'cal-1',
      'group-1',
      withEmpty,
      anchor,
      first.pushedEvents,
    )

    expect(second.removed).toBe(1)
    expect(second.created).toBe(1)
    expect(second.pushedEvents.filter((e) => e.taskId === 't1')).toHaveLength(0)
    expect(second.pushedEvents.find((e) => e.taskId === 't2')).toBeTruthy()
  })

  it('skips disabled blocks and removes previously pushed events when a block is disabled', async () => {
    const anchor = {
      kind: 'start' as const,
      at: new Date('2026-07-23T15:00:00.000Z').toISOString(),
    }

    const normalTasks: Task[] = [{ id: 't1', title: 'Focus', durationMinutes: 60 }]
    const first = await syncTasksToCalendar(
      'cal-1',
      'group-1',
      normalTasks,
      anchor,
      [],
    )
    expect(first.created).toBe(1)

    const withDisabled: Task[] = [
      { id: 't1', title: 'Focus', durationMinutes: 60, disabled: true },
      { id: 't2', title: 'Next', durationMinutes: 30 },
    ]
    const second = await syncTasksToCalendar(
      'cal-1',
      'group-1',
      withDisabled,
      anchor,
      first.pushedEvents,
    )

    expect(second.removed).toBe(1)
    expect(second.created).toBe(1)
    expect(second.pushedEvents.filter((e) => e.taskId === 't1')).toHaveLength(0)
    expect(second.pushedEvents.find((e) => e.taskId === 't2')).toBeTruthy()
  })
})

describe('syncGroupToCalendars — multi-calendar', () => {
  beforeEach(() => {
    mockGapiCalendar()
  })

  const tasks: Task[] = [{ id: 't1', title: 'Focus', durationMinutes: 60 }]
  const anchor = {
    kind: 'start' as const,
    at: new Date('2026-07-23T15:00:00.000Z').toISOString(),
  }

  it('syncs the same group to multiple calendars', async () => {
    const result = await syncGroupToCalendars(
      ['cal-a', 'cal-b'],
      'group-1',
      tasks,
      anchor,
      [],
    )

    expect(result.created).toBe(2)
    expect(result.failures).toHaveLength(0)
    expect(result.pushSnapshots).toHaveLength(2)
    expect(result.pushedEvents).toHaveLength(2)
    expect(
      new Set(result.pushedEvents.map((event) => event.calendarId)),
    ).toEqual(new Set(['cal-a', 'cal-b']))
  })

  it('deletes from calendars removed from the selection', async () => {
    const first = await syncGroupToCalendars(
      ['cal-a', 'cal-b'],
      'group-1',
      tasks,
      anchor,
      [],
    )
    const second = await syncGroupToCalendars(
      ['cal-a'],
      'group-1',
      tasks,
      anchor,
      first.pushedEvents,
    )

    expect(second.removed).toBe(1)
    expect(second.removedCalendarIds).toEqual(['cal-b'])
    expect(second.pushedEvents.every((event) => event.calendarId === 'cal-a')).toBe(
      true,
    )
  })

  it('deletes from every calendar when the selection is empty', async () => {
    const first = await syncGroupToCalendars(
      ['cal-a', 'cal-b'],
      'group-1',
      tasks,
      anchor,
      [],
    )
    const second = await syncGroupToCalendars(
      [],
      'group-1',
      tasks,
      anchor,
      first.pushedEvents,
    )

    expect(second.removed).toBe(2)
    expect(second.created).toBe(0)
    expect(second.updated).toBe(0)
    expect(new Set(second.removedCalendarIds)).toEqual(new Set(['cal-a', 'cal-b']))
    expect(second.pushedEvents).toEqual([])
  })

  it('writes a distinct attendee list per calendar', async () => {
    const { calls } = mockGapiCalendar()
    await syncGroupToCalendars(
      ['cal-a', 'cal-b'],
      'group-1',
      tasks,
      anchor,
      [],
      null,
      undefined,
      {
        'cal-a': [{ email: 'ada@example.com', name: 'Ada' }],
        'cal-b': [{ email: 'bob@example.com' }],
      },
    )
    const inserts = calls.filter((c) => c.method === 'insert')
    expect(inserts).toHaveLength(2)
    expect(inserts.find((c) => c.calendarId === 'cal-a')).toEqual({
      method: 'insert',
      calendarId: 'cal-a',
      sendUpdates: 'none',
      attendees: [{ email: 'ada@example.com', displayName: 'Ada' }],
    })
    expect(inserts.find((c) => c.calendarId === 'cal-b')).toEqual({
      method: 'insert',
      calendarId: 'cal-b',
      sendUpdates: 'none',
      attendees: [{ email: 'bob@example.com' }],
    })
  })

  it('omits failed calendars from successfulCalendarIds', async () => {
    mockGapiCalendar({ failInsertOn: ['cal-b'] })
    const result = await syncGroupToCalendars(
      ['cal-a', 'cal-b'],
      'group-1',
      tasks,
      anchor,
      [],
    )
    expect(result.successfulCalendarIds).toEqual(['cal-a'])
    expect(result.created).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.action).toBe('create')
  })

  it('reports stepped progress for each sync attempt', async () => {
    const progress: { current: number; total: number; label: string }[] = []
    await syncGroupToCalendars(
      ['cal-a', 'cal-b'],
      'group-1',
      [
        { id: 't1', title: 'Focus', durationMinutes: 60 },
        { id: 't2', title: 'Break', durationMinutes: 15 },
      ],
      anchor,
      [],
      null,
      (step) => progress.push(step),
    )

    expect(progress[0]).toMatchObject({ current: 0, total: 4 })
    expect(progress.at(-1)).toMatchObject({ current: 4, total: 4 })
    expect(progress.some((step) => step.label.startsWith('Adding'))).toBe(true)
    expect(progress.filter((step) => step.current > 0)).toHaveLength(4)
  })
})

describe('deleteGroupFromCalendar — progress', () => {
  beforeEach(() => {
    mockGapiCalendar()
  })

  it('reports stepped remove progress', async () => {
    const anchor = {
      kind: 'start' as const,
      at: new Date('2026-07-23T15:00:00.000Z').toISOString(),
    }
    const first = await syncTasksToCalendar(
      'cal-a',
      'group-1',
      [
        { id: 't1', title: 'Focus', durationMinutes: 60 },
        { id: 't2', title: 'Break', durationMinutes: 15 },
      ],
      anchor,
      [],
    )
    const progress: { current: number; total: number; label: string }[] = []
    const dayKey = first.pushedEvents[0]!.dayKey
    await deleteGroupFromCalendar(
      'group-1',
      dayKey,
      first.pushedEvents,
      (step) => progress.push(step),
    )

    expect(progress[0]).toMatchObject({ current: 0, total: 2 })
    expect(progress.at(-1)).toMatchObject({ current: 2, total: 2 })
    expect(progress.some((step) => step.label.startsWith('Removing'))).toBe(true)
  })
})

describe('syncTasksToCalendar — attendees', () => {
  it('writes attendees and never emails guests', async () => {
    const { calls } = mockGapiCalendar()
    const anchor = {
      kind: 'start' as const,
      at: new Date('2026-07-23T15:00:00.000Z').toISOString(),
    }
    const guests = [{ email: 'ada@example.com', name: 'Ada' }]
    const first = await syncTasksToCalendar(
      'cal-a',
      'group-1',
      [{ id: 't1', title: 'Focus', durationMinutes: 60 }],
      anchor,
      [],
      null,
      undefined,
      undefined,
      guests,
    )
    expect(calls.filter((c) => c.method === 'insert')).toEqual([
      {
        method: 'insert',
        calendarId: 'cal-a',
        sendUpdates: 'none',
        attendees: [{ email: 'ada@example.com', displayName: 'Ada' }],
      },
    ])

    await syncTasksToCalendar(
      'cal-a',
      'group-1',
      [{ id: 't1', title: 'Focus', durationMinutes: 60 }],
      anchor,
      first.pushedEvents,
      null,
      undefined,
      undefined,
      guests,
    )
    expect(calls.filter((c) => c.method === 'update')).toEqual([
      {
        method: 'update',
        calendarId: 'cal-a',
        sendUpdates: 'none',
        attendees: [{ email: 'ada@example.com', displayName: 'Ada' }],
      },
    ])

    await deleteGroupFromCalendar(
      'group-1',
      first.pushedEvents[0]!.dayKey,
      first.pushedEvents,
    )
    expect(calls.filter((c) => c.method === 'delete')).toEqual([
      { method: 'delete', calendarId: 'cal-a', sendUpdates: 'none' },
    ])
  })

  it('replaces attendees on update so removed guests are uninvited', async () => {
    const { calls, store } = mockGapiCalendar()
    const anchor = {
      kind: 'start' as const,
      at: new Date('2026-07-23T15:00:00.000Z').toISOString(),
    }
    const tasks = [{ id: 't1', title: 'Focus', durationMinutes: 60 }]
    const first = await syncTasksToCalendar(
      'cal-a',
      'group-1',
      tasks,
      anchor,
      [],
      null,
      undefined,
      undefined,
      [
        { email: 'ada@example.com', name: 'Ada' },
        { email: 'bob@example.com', name: 'Bob' },
      ],
    )

    await syncTasksToCalendar(
      'cal-a',
      'group-1',
      tasks,
      anchor,
      first.pushedEvents,
      null,
      undefined,
      undefined,
      [{ email: 'bob@example.com', name: 'Bob' }],
    )
    expect(calls.filter((c) => c.method === 'update')).toEqual([
      {
        method: 'update',
        calendarId: 'cal-a',
        sendUpdates: 'none',
        attendees: [{ email: 'bob@example.com', displayName: 'Bob' }],
      },
    ])
    expect(store.get(first.pushedEvents[0]!.eventId)?.attendees).toEqual([
      { email: 'bob@example.com', displayName: 'Bob' },
    ])

    await syncTasksToCalendar(
      'cal-a',
      'group-1',
      tasks,
      anchor,
      first.pushedEvents,
      null,
      undefined,
      undefined,
      [],
    )
    expect(calls.filter((c) => c.method === 'update').at(-1)).toEqual({
      method: 'update',
      calendarId: 'cal-a',
      sendUpdates: 'none',
      attendees: [],
    })
    expect(store.get(first.pushedEvents[0]!.eventId)?.attendees).toEqual([])
  })

  it('omits displayName when the guest has no name', async () => {
    const { calls } = mockGapiCalendar()
    await syncTasksToCalendar(
      'cal-a',
      'group-1',
      [{ id: 't1', title: 'Focus', durationMinutes: 60 }],
      {
        kind: 'start',
        at: new Date('2026-07-23T15:00:00.000Z').toISOString(),
      },
      [],
      null,
      undefined,
      undefined,
      [{ email: 'ada@example.com' }],
    )
    expect(calls.filter((c) => c.method === 'insert')).toEqual([
      {
        method: 'insert',
        calendarId: 'cal-a',
        sendUpdates: 'none',
        attendees: [{ email: 'ada@example.com' }],
      },
    ])
  })

  it('does not create events (or attendees) for empty or disabled blocks', async () => {
    const { calls } = mockGapiCalendar()
    const guests = [{ email: 'ada@example.com', name: 'Ada' }]
    await syncTasksToCalendar(
      'cal-a',
      'group-1',
      [
        { id: 't1', title: 'Gap', durationMinutes: 15, empty: true },
        { id: 't2', title: 'Skip', durationMinutes: 20, disabled: true },
        { id: 't3', title: 'Focus', durationMinutes: 60 },
      ],
      {
        kind: 'start',
        at: new Date('2026-07-23T15:00:00.000Z').toISOString(),
      },
      [],
      null,
      undefined,
      undefined,
      guests,
    )
    expect(calls.filter((c) => c.method === 'insert')).toEqual([
      {
        method: 'insert',
        calendarId: 'cal-a',
        sendUpdates: 'none',
        attendees: [{ email: 'ada@example.com', displayName: 'Ada' }],
      },
    ])
  })

  it('writes the block note into the Google event description', async () => {
    const { store } = mockGapiCalendar()
    const result = await syncTasksToCalendar(
      'cal-a',
      'group-1',
      [
        {
          id: 't1',
          title: 'Focus',
          durationMinutes: 60,
          note: 'bring keys',
        },
      ],
      {
        kind: 'start',
        at: new Date('2026-07-23T15:00:00.000Z').toISOString(),
      },
      [],
    )
    const event = store.get(result.pushedEvents[0]!.eventId)
    expect(event?.description).toBe(
      'bring keys\n\nAdded via Time Block, with love ❤️',
    )
  })
})

