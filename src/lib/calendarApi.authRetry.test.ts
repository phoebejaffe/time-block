import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteGroupFromCalendar,
  listCalendars,
} from './calendarApi'
import { refreshAccessToken } from './google'
import type { PushedEvent } from './pushedEvents'

vi.mock('./google', () => ({
  refreshAccessToken: vi.fn(),
}))

const AUTH_401 = { status: 401, message: 'Invalid Credentials' }

function mockGapiCalendar(options?: {
  failListWithAuthOnce?: boolean
  failGetWithAuthOnce?: boolean
  failDeleteWithAuthOnce?: boolean
  alwaysFailListWithAuth?: boolean
  failListWith?: unknown
}) {
  const store = new Map<string, { id: string }>([['evt-1', { id: 'evt-1' }]])
  const calls = { list: 0, get: 0, delete: 0 }
  const fired = { list: false, get: false, del: false }

  const events = {
    get: async ({ eventId }: { calendarId: string; eventId: string }) => {
      calls.get += 1
      if (options?.failGetWithAuthOnce && !fired.get) {
        fired.get = true
        throw AUTH_401
      }
      if (!store.has(eventId)) throw { status: 404 }
      return { result: { id: eventId, status: 'confirmed' } }
    },
    delete: async ({ eventId }: { calendarId: string; eventId: string }) => {
      calls.delete += 1
      if (options?.failDeleteWithAuthOnce && !fired.del) {
        fired.del = true
        throw AUTH_401
      }
      store.delete(eventId)
      return { result: {} }
    },
  }

  const calendarList = {
    list: async () => {
      calls.list += 1
      if (options?.alwaysFailListWithAuth) throw AUTH_401
      if (options?.failListWithAuthOnce && !fired.list) {
        fired.list = true
        throw AUTH_401
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

describe('gapi auth-error retry', () => {
  beforeEach(() => {
    vi.mocked(refreshAccessToken).mockReset().mockResolvedValue(true)
  })

  it('refreshes the token and retries once after a 401', async () => {
    const { calls } = mockGapiCalendar({ failListWithAuthOnce: true })

    const calendars = await listCalendars()

    expect(calendars.map((c) => c.id)).toEqual(['cal-1'])
    expect(calls.list).toBe(2)
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(refreshAccessToken).toHaveBeenCalledWith('retry')
  })

  it('surfaces the original error when the refresh fails', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue(false)
    const { calls } = mockGapiCalendar({ failListWithAuthOnce: true })

    await expect(listCalendars()).rejects.toMatchObject({ status: 401 })
    expect(calls.list).toBe(1)
  })

  it('surfaces the retried error when the call keeps failing', async () => {
    const { calls } = mockGapiCalendar({ alwaysFailListWithAuth: true })

    await expect(listCalendars()).rejects.toMatchObject({ status: 401 })
    expect(calls.list).toBe(2)
  })

  it('does not refresh on non-auth errors', async () => {
    const { calls } = mockGapiCalendar({ failListWith: { status: 403 } })

    await expect(listCalendars()).rejects.toMatchObject({ status: 403 })
    expect(calls.list).toBe(1)
    expect(refreshAccessToken).not.toHaveBeenCalled()
  })

  it('retries inside delete flows after a 401 on the event lookup', async () => {
    const { calls } = mockGapiCalendar({ failGetWithAuthOnce: true })
    const pushed: PushedEvent[] = [
      {
        calendarId: 'cal-1',
        eventId: 'evt-1',
        taskId: 't1',
        groupId: 'g1',
        dayKey: '2026-10-26',
        pushedAt: '2026-10-26T00:00:00Z',
      },
    ]

    const result = await deleteGroupFromCalendar('g1', '2026-10-26', pushed)

    expect(result.removed).toBe(1)
    expect(result.failures).toHaveLength(0)
    expect(calls.get).toBe(2)
    expect(calls.delete).toBe(1)
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
  })
})
