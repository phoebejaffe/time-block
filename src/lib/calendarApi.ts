import { formatError } from './errors'
import {
  prunePushedEvents,
  stackPushFingerprint,
  timeblockEventDescription,
  type PushSnapshot,
  type PushedEvent,
} from './pushedEvents'
import type { Task } from './tasks'
import { localDateKey, isTaskDisabled, isTaskEmpty, resolveStack, type StackAnchor } from './tasks'

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

function eventResource(
  task: {
    title: string
    start: Date
    end: Date
  },
  userId: string | null | undefined,
): gapi.client.calendar.Event {
  return {
    summary: task.title,
    description: timeblockEventDescription(userId),
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
  pushedEvents: PushedEvent[]
  pushSnapshot: PushSnapshot | null
}


/**
 * Push the current stack to Google Calendar.
 * Updates events we previously created (tracked in synced push history for ~1 month),
 * recreates any that were deleted elsewhere, inserts new blocks, and removes
 * leftover events from an earlier push on the same day. Continues after
 * individual event failures and reports them in `failures`.
 */
export async function syncTasksToCalendar(
  calendarId: string,
  groupId: string,
  tasks: Task[],
  anchor: StackAnchor,
  pushedEvents: PushedEvent[],
  userId?: string | null,
): Promise<SyncTasksResult> {
  const resolved = resolveStack(tasks, anchor)
  const dayKey = localDateKey(anchor.at)
  let tracked = [...pushedEvents]
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

  // Dedup within this group/calendar/day only — a block pushed to one day
  // must never be conflated with the same block pushed to a different day.
  function upsertTracked(next: PushedEvent) {
    tracked = tracked.filter(
      (e) =>
        !(
          e.calendarId === next.calendarId &&
          e.groupId === next.groupId &&
          e.dayKey === next.dayKey &&
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

  for (const task of resolved) {
    if (isTaskEmpty(task) || isTaskDisabled(task)) {
      const matches = tracked.filter(
        (e) =>
          e.calendarId === calendarId &&
          e.groupId === groupId &&
          e.dayKey === dayKey &&
          e.taskId === task.id,
      )
      for (const match of matches) {
        const unusedIdx = unusedDay.findIndex((e) => e.eventId === match.eventId)
        if (unusedIdx >= 0) unusedDay.splice(unusedIdx, 1)

        try {
          const stillThere = await isActiveCalendarEvent(
            calendarId,
            match.eventId,
          )
          if (stillThere) {
            await gapi.client.calendar.events.delete({
              calendarId,
              eventId: match.eventId,
            })
          }
          forgetTracked(match)
          removed += 1
        } catch (err) {
          if (isNotFoundError(err)) {
            forgetTracked(match)
            removed += 1
            continue
          }
          failures.push({
            taskId: task.id,
            title: task.title,
            action: 'remove',
            message: formatError(err),
          })
        }
      }
      continue
    }

    const resource = eventResource(task, userId)
    // Only ever reuse an event already pushed for this exact group/day —
    // never one from another day, even if the block id matches.
    const match = unusedDay.find((e) => e.taskId === task.id) || unusedDay[0]

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

  const pruned = prunePushedEvents(tracked)
  let pushSnapshot: PushSnapshot | null = null
  if (failures.length === 0) {
    pushSnapshot = {
      calendarId,
      groupId,
      dayKey,
      fingerprint: stackPushFingerprint(
        anchor,
        resolved.filter((task) => !isTaskEmpty(task) && !isTaskDisabled(task)),
      ),
      savedAt: new Date().toISOString(),
    }
  }
  return {
    updated,
    created,
    removed,
    failures,
    pushedEvents: pruned,
    pushSnapshot,
  }
}

export type DeleteFromCalendarResult = {
  removed: number
  failures: SyncTaskFailure[]
  pushedEvents: PushedEvent[]
}

/** Human-readable calendar names for events pushed on this group/day. */
export function calendarNamesForPushedGroupDay(
  pushedEvents: PushedEvent[],
  calendars: GoogleCalendar[],
  groupId: string,
  dayKey: string,
): string[] {
  const ids = [
    ...new Set(
      pushedEvents
        .filter((e) => e.groupId === groupId && e.dayKey === dayKey)
        .map((e) => e.calendarId),
    ),
  ]
  return ids.map((id) => calendars.find((c) => c.id === id)?.summary ?? id)
}

export type SyncGroupCalendarsResult = {
  updated: number
  created: number
  removed: number
  failures: SyncTaskFailure[]
  pushedEvents: PushedEvent[]
  pushSnapshots: PushSnapshot[]
  removedCalendarIds: string[]
}

/** Sync a group to multiple calendars; delete from deselected calendars. */
export async function syncGroupToCalendars(
  calendarIds: string[],
  groupId: string,
  tasks: Task[],
  anchor: StackAnchor,
  pushedEvents: PushedEvent[],
  userId?: string | null,
): Promise<SyncGroupCalendarsResult> {
  const dayKey = localDateKey(anchor.at)
  const previouslyPushed = [
    ...new Set(
      pushedEvents
        .filter((e) => e.groupId === groupId && e.dayKey === dayKey)
        .map((e) => e.calendarId),
    ),
  ]
  const removedCalendarIds = previouslyPushed.filter(
    (id) => !calendarIds.includes(id),
  )

  let tracked = [...pushedEvents]
  let updated = 0
  let created = 0
  let removed = 0
  const failures: SyncTaskFailure[] = []
  const pushSnapshots: PushSnapshot[] = []

  for (const calendarId of removedCalendarIds) {
    const result = await deleteGroupFromCalendarOnCalendar(
      groupId,
      dayKey,
      calendarId,
      tracked,
    )
    tracked = result.pushedEvents
    removed += result.removed
    failures.push(...result.failures)
  }

  for (const calendarId of calendarIds) {
    const result = await syncTasksToCalendar(
      calendarId,
      groupId,
      tasks,
      anchor,
      tracked,
      userId,
    )
    tracked = result.pushedEvents
    updated += result.updated
    created += result.created
    removed += result.removed
    failures.push(...result.failures)
    if (result.pushSnapshot) {
      pushSnapshots.push(result.pushSnapshot)
    }
  }

  return {
    updated,
    created,
    removed,
    failures,
    pushedEvents: tracked,
    pushSnapshots,
    removedCalendarIds,
  }
}

/** Delete pushed events for this group/day on one calendar. */
export async function deleteGroupFromCalendarOnCalendar(
  groupId: string,
  dayKey: string,
  calendarId: string,
  pushedEvents: PushedEvent[],
): Promise<DeleteFromCalendarResult> {
  const toDelete = pushedEvents.filter(
    (e) =>
      e.groupId === groupId &&
      e.dayKey === dayKey &&
      e.calendarId === calendarId,
  )
  let tracked = [...pushedEvents]
  let removed = 0
  const failures: SyncTaskFailure[] = []

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

  for (const event of toDelete) {
    try {
      const stillThere = await isActiveCalendarEvent(
        event.calendarId,
        event.eventId,
      )
      if (stillThere) {
        await gapi.client.calendar.events.delete({
          calendarId: event.calendarId,
          eventId: event.eventId,
        })
      }
      forgetTracked(event)
      removed += 1
    } catch (err) {
      if (isNotFoundError(err)) {
        forgetTracked(event)
        removed += 1
        continue
      }
      failures.push({
        taskId: event.taskId,
        title: 'Calendar event',
        action: 'remove',
        message: formatError(err),
      })
    }
  }

  return {
    removed,
    failures,
    pushedEvents: prunePushedEvents(tracked),
  }
}

/** Delete all calendar events we previously pushed for this group on this day. */
export async function deleteGroupFromCalendar(
  groupId: string,
  dayKey: string,
  pushedEvents: PushedEvent[],
): Promise<DeleteFromCalendarResult> {
  const toDelete = pushedEvents.filter(
    (e) => e.groupId === groupId && e.dayKey === dayKey,
  )
  let tracked = [...pushedEvents]
  let removed = 0
  const failures: SyncTaskFailure[] = []

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

  for (const event of toDelete) {
    try {
      const stillThere = await isActiveCalendarEvent(
        event.calendarId,
        event.eventId,
      )
      if (stillThere) {
        await gapi.client.calendar.events.delete({
          calendarId: event.calendarId,
          eventId: event.eventId,
        })
      }
      forgetTracked(event)
      removed += 1
    } catch (err) {
      if (isNotFoundError(err)) {
        forgetTracked(event)
        removed += 1
        continue
      }
      failures.push({
        taskId: event.taskId,
        title: 'Calendar event',
        action: 'remove',
        message: formatError(err),
      })
    }
  }

  return {
    removed,
    failures,
    pushedEvents: prunePushedEvents(tracked),
  }
}

export function calendarsWritable(calendars: GoogleCalendar[]): GoogleCalendar[] {
  return calendars.filter((c) => {
    const role = (c.accessRole || '').toLowerCase()
    return role === 'owner' || role === 'writer'
  })
}
