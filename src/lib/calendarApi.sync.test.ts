import { beforeEach, describe, expect, it } from 'vitest'
import { syncTasksToCalendar } from './calendarApi'
import type { Task } from './tasks'

type FakeEvent = { id: string; summary: string; start: string; end: string }

function mockGapiCalendar() {
  const store = new Map<string, FakeEvent>()
  let nextId = 1

  const events = {
    get: async ({ eventId }: { calendarId: string; eventId: string }) => {
      const event = store.get(eventId)
      if (!event) {
        const err = { status: 404 }
        throw err
      }
      return { result: { id: event.id, status: 'confirmed' } }
    },
    patch: async ({
      eventId,
      resource,
    }: {
      calendarId: string
      eventId: string
      resource: { summary?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }
    }) => {
      const event = store.get(eventId)
      if (!event) throw { status: 404 }
      store.set(eventId, {
        ...event,
        summary: resource.summary ?? event.summary,
        start: resource.start?.dateTime ?? event.start,
        end: resource.end?.dateTime ?? event.end,
      })
      return { result: { id: eventId } }
    },
    insert: async ({
      resource,
    }: {
      calendarId: string
      resource: { summary?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }
    }) => {
      const id = `evt-${nextId++}`
      store.set(id, {
        id,
        summary: resource.summary ?? '',
        start: resource.start?.dateTime ?? '',
        end: resource.end?.dateTime ?? '',
      })
      return { result: { id } }
    },
    delete: async ({ eventId }: { calendarId: string; eventId: string }) => {
      store.delete(eventId)
    },
  }

  ;(globalThis as unknown as { gapi: unknown }).gapi = {
    client: { calendar: { events } },
  }

  return store
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
})
