import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isRateLimitError,
  listCalendars,
  rateLimitBackoff,
  syncTasksToCalendar,
} from './calendarApi'
import { refreshAccessToken } from './google'
import type { PushedEvent } from './pushedEvents'
import type { Task } from './tasks'

vi.mock('./google', () => ({
  refreshAccessToken: vi.fn(),
}))

const RATE_LIMIT_403 = {
  status: 403,
  result: {
    error: {
      code: 403,
      message: 'Rate Limit Exceeded',
      errors: [
        {
          domain: 'usageLimits',
          reason: 'rateLimitExceeded',
          message: 'Rate Limit Exceeded',
        },
      ],
    },
  },
}

const realSleep = rateLimitBackoff.sleep

function mockGapiCalendar(options?: {
  rateLimitListTimes?: number
  rateLimitInsertTimes?: number
  rateLimitUpdateTimes?: number
  failListWith?: unknown
}) {
  const store = new Map<
    string,
    { id: string; summary: string; start: string; end: string }
  >()
  const calls = { list: 0, get: 0, insert: 0, update: 0, delete: 0 }
  let nextId = 1
  let listFailures = options?.rateLimitListTimes ?? 0
  let insertFailures = options?.rateLimitInsertTimes ?? 0
  let updateFailures = options?.rateLimitUpdateTimes ?? 0

  const events = {
    get: async ({ eventId }: { calendarId: string; eventId: string }) => {
      calls.get += 1
      const event = store.get(eventId)
      if (!event) throw { status: 404 }
      return {
        result: {
          id: event.id,
          status: 'confirmed',
          summary: event.summary,
          start: { dateTime: event.start },
          end: { dateTime: event.end },
        },
      }
    },
    insert: async ({
      resource,
    }: {
      calendarId: string
      resource: { summary?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }
    }) => {
      calls.insert += 1
      if (insertFailures > 0) {
        insertFailures -= 1
        throw RATE_LIMIT_403
      }
      const id = `evt-${nextId++}`
      store.set(id, {
        id,
        summary: resource.summary ?? '',
        start: resource.start?.dateTime ?? '',
        end: resource.end?.dateTime ?? '',
      })
      return { result: { id } }
    },
    update: async ({
      eventId,
      resource,
    }: {
      calendarId: string
      eventId: string
      resource: { summary?: string }
    }) => {
      calls.update += 1
      if (updateFailures > 0) {
        updateFailures -= 1
        throw RATE_LIMIT_403
      }
      const event = store.get(eventId)
      if (!event) throw { status: 404 }
      store.set(eventId, { ...event, summary: resource.summary ?? event.summary })
      return { result: { id: eventId } }
    },
    delete: async ({ eventId }: { calendarId: string; eventId: string }) => {
      calls.delete += 1
      store.delete(eventId)
      return { result: {} }
    },
  }

  const calendarList = {
    list: async () => {
      calls.list += 1
      if (listFailures > 0) {
        listFailures -= 1
        throw RATE_LIMIT_403
      }
      if (options?.failListWith !== undefined) throw options.failListWith
      return {
        result: {
          items: [{ id: 'cal-1', summary: 'Main', primary: true }],
        },
      }
    },
  }

  ;(globalThis as unknown as { gapi: unknown }).gapi = {
    client: { calendar: { events, calendarList } },
  }

  return { calls, store }
}

const anchor = {
  kind: 'start' as const,
  at: new Date('2026-07-23T15:00:00.000Z').toISOString(),
}
const tasks: Task[] = [{ id: 't1', title: 'Focus', durationMinutes: 60 }]

describe('isRateLimitError', () => {
  it('matches 403/429 quota errors by reason, code, and message', () => {
    expect(isRateLimitError(RATE_LIMIT_403)).toBe(true)
    expect(isRateLimitError({ status: 429 })).toBe(true)
    expect(
      isRateLimitError({
        result: { error: { errors: [{ reason: 'userRateLimitExceeded' }] } },
      }),
    ).toBe(true)
    expect(isRateLimitError({ status: 403, body: 'User Rate Limit Exceeded' })).toBe(
      true,
    )
    expect(isRateLimitError('Rate Limit Exceeded')).toBe(true)
  })

  it('does not match permission 403s or unrelated errors', () => {
    expect(isRateLimitError({ status: 403 })).toBe(false)
    expect(isRateLimitError({ status: 404 })).toBe(false)
    expect(
      isRateLimitError({
        result: { error: { code: 403, errors: [{ reason: 'forbidden' }] } },
      }),
    ).toBe(false)
    expect(isRateLimitError(null)).toBe(false)
  })
})

describe('gapi rate-limit backoff', () => {
  beforeEach(() => {
    vi.mocked(refreshAccessToken).mockReset().mockResolvedValue(true)
    rateLimitBackoff.sleep = () => Promise.resolve()
  })

  afterEach(() => {
    rateLimitBackoff.sleep = realSleep
  })

  it('retries a throttled call and returns the result', async () => {
    const { calls } = mockGapiCalendar({ rateLimitListTimes: 1 })

    const calendars = await listCalendars()

    expect(calendars.map((c) => c.id)).toEqual(['cal-1'])
    expect(calls.list).toBe(2)
    expect(refreshAccessToken).not.toHaveBeenCalled()
  })

  it('gives up after the retry budget on persistent throttling', async () => {
    const { calls } = mockGapiCalendar({ rateLimitListTimes: 99 })

    await expect(listCalendars()).rejects.toMatchObject({ status: 403 })
    expect(calls.list).toBe(5)
  })

  it('does not retry a non-quota 403', async () => {
    const { calls } = mockGapiCalendar({
      failListWith: {
        status: 403,
        result: { error: { code: 403, errors: [{ reason: 'forbidden' }] } },
      },
    })

    await expect(listCalendars()).rejects.toMatchObject({ status: 403 })
    expect(calls.list).toBe(1)
  })

  it('retries an insert during sync so the task still counts as created', async () => {
    const { calls } = mockGapiCalendar({ rateLimitInsertTimes: 1 })

    const result = await syncTasksToCalendar('cal-1', 'g1', tasks, anchor, [])

    expect(result.created).toBe(1)
    expect(result.failures).toHaveLength(0)
    expect(calls.insert).toBe(2)
  })

  it('retries an update during sync so the task still counts as updated', async () => {
    const { calls, store } = mockGapiCalendar({ rateLimitUpdateTimes: 1 })
    store.set('evt-1', {
      id: 'evt-1',
      summary: 'Old title',
      start: '2026-07-23T15:00:00.000Z',
      end: '2026-07-23T16:00:00.000Z',
    })
    const pushed: PushedEvent[] = [
      {
        calendarId: 'cal-1',
        eventId: 'evt-1',
        taskId: 't1',
        groupId: 'g1',
        dayKey: '2026-07-23',
        pushedAt: '2026-07-23T00:00:00Z',
      },
    ]

    const result = await syncTasksToCalendar(
      'cal-1',
      'g1',
      tasks,
      anchor,
      pushed,
    )

    expect(result.updated).toBe(1)
    expect(result.failures).toHaveLength(0)
    expect(calls.update).toBe(2)
  })

  it('records a failure only after the retry budget is exhausted', async () => {
    const { calls } = mockGapiCalendar({ rateLimitInsertTimes: 99 })

    const result = await syncTasksToCalendar('cal-1', 'g1', tasks, anchor, [])

    expect(result.created).toBe(0)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({
      taskId: 't1',
      action: 'create',
    })
    expect(result.failures[0]!.message).toContain('Rate Limit Exceeded')
    expect(calls.insert).toBe(5)
  })
})
