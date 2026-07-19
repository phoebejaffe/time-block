import { formatError } from './errors'
import {
  loadPushedEvents,
  savePushedEvents,
  savePushSnapshot,
  stackPushFingerprint,
  TIMEBLOCK_EVENT_DESCRIPTION,
  type PushedEvent,
} from './pushedEvents'
import type { Task } from './tasks'
import { localDateKey, resolveStack, type StackAnchor } from './tasks'

export type GoogleCalendar = {
  id: string
  summary: string
  backgroundColor: string
  foregroundColor: string
  primary?: boolean
  selected?: boolean
  accessRole?: string
}

export type CalendarEvent = {
  id: string
  calendarId: string
  title: string
  start: string
  end: string
  allDay: boolean
  backgroundColor: string
  borderColor: string
  editable: false
  extendedProps: {
    source: 'google'
    calendarId: string
  }
}

function hexOrFallback(color: string | undefined, fallback: string): string {
  return color && /^#/.test(color) ? color : fallback
}

/** Darken a #rrggbb color so borders stay visible against matching fills. */
function darkenHex(hex: string, amount = 0.28): string {
  const raw = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return hex
  const channel = (i: number) => {
    const n = parseInt(raw.slice(i, i + 2), 16)
    return Math.max(0, Math.round(n * (1 - amount)))
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(2)}${channel(4)}`
}

export async function listCalendars(): Promise<GoogleCalendar[]> {
  const res = await gapi.client.calendar.calendarList.list({
    minAccessRole: 'reader',
  })
  const items = res.result.items ?? []
  return items
    .filter((c): c is NonNullable<typeof c> & { id: string } => Boolean(c.id))
    .map((c) => ({
      id: c.id!,
      summary: c.summaryOverride || c.summary || c.id!,
      backgroundColor: hexOrFallback(c.backgroundColor, '#4285f4'),
      foregroundColor: hexOrFallback(c.foregroundColor, '#ffffff'),
      primary: c.primary,
      selected: c.selected,
      accessRole: c.accessRole,
    }))
    .sort((a, b) => {
      if (a.primary && !b.primary) return -1
      if (!a.primary && b.primary) return 1
      return a.summary.localeCompare(b.summary)
    })
}

function eventTimes(event: gapi.client.calendar.Event): {
  start: string
  end: string
  allDay: boolean
} | null {
  if (event.start?.date && event.end?.date) {
    return {
      start: event.start.date,
      end: event.end.date,
      allDay: true,
    }
  }
  if (event.start?.dateTime && event.end?.dateTime) {
    return {
      start: event.start.dateTime,
      end: event.end.dateTime,
      allDay: false,
    }
  }
  return null
}

export async function listEvents(
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
  color: string,
): Promise<CalendarEvent[]> {
  const res = await gapi.client.calendar.events.list({
    calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 2500,
  })

  const items = res.result.items ?? []
  const events: CalendarEvent[] = []

  for (const item of items) {
    if (!item.id || item.status === 'cancelled') continue
    const times = eventTimes(item)
    if (!times) continue
    events.push({
      id: `${calendarId}:${item.id}`,
      calendarId,
      title: item.summary || '(No title)',
      start: times.start,
      end: times.end,
      allDay: times.allDay,
      backgroundColor: color,
      borderColor: darkenHex(color),
      editable: false,
      extendedProps: {
        source: 'google',
        calendarId,
      },
    })
  }

  return events
}

/** Exported for tests — gapi error shapes vary by browser/client version. */
export function isNotFoundError(err: unknown): boolean {
  if (err == null) return false

  if (typeof err === 'string') {
    const lower = err.toLowerCase()
    return lower.includes('not found') || lower.includes('"code": 404')
  }

  if (typeof err !== 'object') return false
  const e = err as {
    status?: number
    statusCode?: number
    message?: string
    body?: string
    error?: {
      code?: number
      message?: string
      errors?: Array<{ reason?: string }>
    }
    result?: {
      error?: {
        code?: number
        message?: string
        errors?: Array<{ reason?: string }>
      }
    }
  }

  const code =
    e.status ?? e.statusCode ?? e.result?.error?.code ?? e.error?.code
  if (code === 404 || code === 410) return true

  const reasons = [
    ...(e.result?.error?.errors ?? []),
    ...(e.error?.errors ?? []),
  ]
  if (
    reasons.some(
      (r) => r.reason === 'notFound' || r.reason === 'deleted',
    )
  ) {
    return true
  }

  const message = [
    e.message,
    e.result?.error?.message,
    e.error?.message,
    e.body,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return (
    message.includes('not found') ||
    message.includes('has been deleted') ||
    message.includes('"code": 404')
  )
}

function eventResource(task: {
  title: string
  start: Date
  end: Date
}): gapi.client.calendar.Event {
  return {
    summary: task.title,
    description: TIMEBLOCK_EVENT_DESCRIPTION,
    start: { dateTime: task.start.toISOString() },
    end: { dateTime: task.end.toISOString() },
  }
}

/** Returns true when the event exists and is not cancelled/trashed. */
async function isActiveCalendarEvent(
  calendarId: string,
  eventId: string,
): Promise<boolean> {
  try {
    const res = await gapi.client.calendar.events.get({
      calendarId,
      eventId,
    })
    return Boolean(res.result.id) && res.result.status !== 'cancelled'
  } catch (err) {
    if (isNotFoundError(err)) return false
    throw err
  }
}

export type SyncTaskFailure = {
  taskId: string
  title: string
  action: 'update' | 'create' | 'remove'
  message: string
}

export type SyncTasksResult = {
  updated: number
  created: number
  removed: number
  failures: SyncTaskFailure[]
}


/**
 * Push the current stack to Google Calendar.
 * Updates events we previously created (tracked in localStorage for ~1 month),
 * recreates any that were deleted elsewhere, inserts new blocks, and removes
 * leftover events from an earlier push on the same day. If the target calendar
 * changed, also deletes that group/day's events from the previous calendar(s).
 * Continues after individual event failures and reports them in `failures`.
 */
export async function syncTasksToCalendar(
  calendarId: string,
  groupId: string,
  tasks: Task[],
  anchor: StackAnchor,
): Promise<SyncTasksResult> {
  const resolved = resolveStack(tasks, anchor)
  const dayKey = localDateKey(anchor.at)
  let tracked = loadPushedEvents()
  let updated = 0
  let created = 0
  let removed = 0
  const failures: SyncTaskFailure[] = []

  const dayPool = tracked.filter(
    (e) =>
      e.calendarId === calendarId &&
      e.groupId === groupId &&
      e.dayKey === dayKey,
  )
  const unusedDay = [...dayPool]
  const previousCalendars = tracked.filter(
    (e) =>
      e.groupId === groupId &&
      e.dayKey === dayKey &&
      e.calendarId !== calendarId,
  )

  function upsertTracked(next: PushedEvent) {
    tracked = tracked.filter(
      (e) =>
        !(
          e.calendarId === next.calendarId &&
          e.groupId === next.groupId &&
          (e.eventId === next.eventId || e.taskId === next.taskId)
        ),
    )
    tracked.push(next)
  }

  function forgetTracked(
    event: Pick<PushedEvent, 'calendarId' | 'groupId' | 'eventId'>,
  ) {
    tracked = tracked.filter(
      (e) =>
        !(
          e.calendarId === event.calendarId &&
          e.groupId === event.groupId &&
          e.eventId === event.eventId
        ),
    )
  }

  // Target calendar changed — delete this stack's events from the old one(s).
  for (const orphan of previousCalendars) {
    try {
      const stillThere = await isActiveCalendarEvent(
        orphan.calendarId,
        orphan.eventId,
      )
      if (stillThere) {
        await gapi.client.calendar.events.delete({
          calendarId: orphan.calendarId,
          eventId: orphan.eventId,
        })
      }
      forgetTracked(orphan)
      removed += 1
    } catch (err) {
      if (isNotFoundError(err)) {
        forgetTracked(orphan)
        removed += 1
        continue
      }
      failures.push({
        taskId: orphan.taskId,
        title: 'Previously synced event',
        action: 'remove',
        message: formatError(err),
      })
    }
  }

  for (const task of resolved) {
    const resource = eventResource(task)
    const match =
      unusedDay.find((e) => e.taskId === task.id) ||
      tracked.find(
        (e) =>
          e.calendarId === calendarId &&
          e.groupId === groupId &&
          e.taskId === task.id,
      ) ||
      unusedDay[0]

    if (match) {
      const idx = unusedDay.indexOf(match)
      if (idx >= 0) unusedDay.splice(idx, 1)

      try {
        const stillThere = await isActiveCalendarEvent(
          calendarId,
          match.eventId,
        )
        if (stillThere) {
          try {
            await gapi.client.calendar.events.patch({
              calendarId,
              eventId: match.eventId,
              resource,
            })
            upsertTracked({
              calendarId,
              eventId: match.eventId,
              taskId: task.id,
              groupId,
              dayKey,
              pushedAt: new Date().toISOString(),
            })
            updated += 1
            continue
          } catch (err) {
            if (!isNotFoundError(err)) {
              failures.push({
                taskId: task.id,
                title: task.title,
                action: 'update',
                message: formatError(err),
              })
              continue
            }
            forgetTracked(match)
          }
        } else {
          forgetTracked(match)
        }
      } catch (err) {
        failures.push({
          taskId: task.id,
          title: task.title,
          action: 'update',
          message: formatError(err),
        })
        continue
      }
    }

    try {
      const res = await gapi.client.calendar.events.insert({
        calendarId,
        resource,
      })
      const eventId = res.result.id
      if (!eventId) {
        throw new Error('Google Calendar did not return an event id')
      }
      upsertTracked({
        calendarId,
        eventId,
        taskId: task.id,
        groupId,
        dayKey,
        pushedAt: new Date().toISOString(),
      })
      created += 1
    } catch (err) {
      failures.push({
        taskId: task.id,
        title: task.title,
        action: 'create',
        message: formatError(err),
      })
    }
  }

  for (const orphan of unusedDay) {
    try {
      const stillThere = await isActiveCalendarEvent(
        calendarId,
        orphan.eventId,
      )
      if (stillThere) {
        await gapi.client.calendar.events.delete({
          calendarId,
          eventId: orphan.eventId,
        })
      }
      forgetTracked(orphan)
      removed += 1
    } catch (err) {
      if (isNotFoundError(err)) {
        forgetTracked(orphan)
        removed += 1
        continue
      }
      failures.push({
        taskId: orphan.taskId,
        title: 'Previously synced event',
        action: 'remove',
        message: formatError(err),
      })
    }
  }

  savePushedEvents(tracked)
  if (failures.length === 0) {
    savePushSnapshot(
      calendarId,
      groupId,
      dayKey,
      stackPushFingerprint(anchor, resolved),
    )
  }
  return { updated, created, removed, failures }
}

export function calendarsWritable(calendars: GoogleCalendar[]): GoogleCalendar[] {
  return calendars.filter(
    (c) => c.accessRole === 'owner' || c.accessRole === 'writer',
  )
}
