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
import type { CalendarGuest } from './savedCalendarUsers'

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
  guests: CalendarGuest[] = [],
): gapi.client.calendar.Event {
  return {
    summary: task.title,
    description: timeblockEventDescription(userId),
    start: { dateTime: task.start.toISOString() },
    end: { dateTime: task.end.toISOString() },
    attendees: guests.map((guest) => ({
      email: guest.email,
      ...(guest.name ? { displayName: guest.name } : {}),
    })),
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

export type SyncProgress = {
  current: number
  total: number
  label: string
}

export type SyncProgressCallback = (progress: SyncProgress) => void

/** Count create/update/remove attempts for one calendar sync (no API calls). */
export function countTasksSyncOps(
  calendarId: string,
  groupId: string,
  tasks: Task[],
  anchor: StackAnchor,
  pushedEvents: PushedEvent[],
): number {
  const resolved = resolveStack(tasks, anchor)
  const dayKey = localDateKey(anchor.at)
  const unusedDay = pushedEvents.filter(
    (e) =>
      e.calendarId === calendarId &&
      e.groupId === groupId &&
      e.dayKey === dayKey,
  )
  let ops = 0

  for (const task of resolved) {
    if (isTaskEmpty(task) || isTaskDisabled(task)) {
      const matches = pushedEvents.filter(
        (e) =>
          e.calendarId === calendarId &&
          e.groupId === groupId &&
          e.dayKey === dayKey &&
          e.taskId === task.id,
      )
      for (const match of matches) {
        ops += 1
        const unusedIdx = unusedDay.findIndex((e) => e.eventId === match.eventId)
        if (unusedIdx >= 0) unusedDay.splice(unusedIdx, 1)
      }
      continue
    }

    ops += 1
    const match = unusedDay.find((e) => e.taskId === task.id) || unusedDay[0]
    if (match) {
      const idx = unusedDay.indexOf(match)
      if (idx >= 0) unusedDay.splice(idx, 1)
    }
  }

  return ops + unusedDay.length
}

function makeProgressTicker(total: number, onProgress?: SyncProgressCallback) {
  const safeTotal = Math.max(total, 1)
  let current = 0
  onProgress?.({
    current: 0,
    total: safeTotal,
    label: total === 0 ? 'Finishing…' : 'Starting…',
  })
  return (labelPrefix: 'Updating' | 'Adding' | 'Removing') => {
    current = Math.min(current + 1, safeTotal)
    onProgress?.({
      current,
      total: safeTotal,
      label: `${labelPrefix} ${current} of ${safeTotal}…`,
    })
  }
}

/** Bound concurrent Google Calendar writes to stay under typical rate limits. */
const CALENDAR_API_CONCURRENCY = 6

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let nextIndex = 0
  async function worker() {
    for (;;) {
      const index = nextIndex++
      if (index >= items.length) return
      results[index] = await fn(items[index]!, index)
    }
  }
  const pool = Math.min(Math.max(concurrency, 1), items.length)
  await Promise.all(Array.from({ length: pool }, () => worker()))
  return results
}

function replaceCalendarDayEvents(
  base: PushedEvent[],
  calendarId: string,
  groupId: string,
  dayKey: string,
  nextFull: PushedEvent[],
): PushedEvent[] {
  const without = base.filter(
    (e) =>
      !(
        e.calendarId === calendarId &&
        e.groupId === groupId &&
        e.dayKey === dayKey
      ),
  )
  const replacement = nextFull.filter(
    (e) =>
      e.calendarId === calendarId &&
      e.groupId === groupId &&
      e.dayKey === dayKey,
  )
  return prunePushedEvents([...without, ...replacement])
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
 * Event API calls for this calendar run concurrently (bounded).
 */
export async function syncTasksToCalendar(
  calendarId: string,
  groupId: string,
  tasks: Task[],
  anchor: StackAnchor,
  pushedEvents: PushedEvent[],
  userId?: string | null,
  onProgress?: SyncProgressCallback,
  tickOverride?: (labelPrefix: 'Updating' | 'Adding' | 'Removing') => void,
  guests: CalendarGuest[] = [],
): Promise<SyncTasksResult> {
  const resolved = resolveStack(tasks, anchor)
  const dayKey = localDateKey(anchor.at)
  let tracked = [...pushedEvents]
  let updated = 0
  let created = 0
  let removed = 0
  const failures: SyncTaskFailure[] = []
  const tick =
    tickOverride ??
    makeProgressTicker(
      countTasksSyncOps(calendarId, groupId, tasks, anchor, pushedEvents),
      onProgress,
    )

  const dayPool = tracked.filter(
    (e) =>
      e.calendarId === calendarId &&
      e.groupId === groupId &&
      e.dayKey === dayKey,
  )
  const unusedDay = [...dayPool]

  type PlannedOp =
    | {
        kind: 'remove'
        taskId: string
        title: string
        event: PushedEvent
      }
    | {
        kind: 'upsert'
        taskId: string
        title: string
        resource: gapi.client.calendar.Event
        match: PushedEvent | null
      }

  const planned: PlannedOp[] = []

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
        planned.push({
          kind: 'remove',
          taskId: task.id,
          title: task.title,
          event: match,
        })
      }
      continue
    }

    // Only ever reuse an event already pushed for this exact group/day —
    // never one from another day, even if the block id matches.
    const match = unusedDay.find((e) => e.taskId === task.id) || unusedDay[0] || null
    if (match) {
      const idx = unusedDay.indexOf(match)
      if (idx >= 0) unusedDay.splice(idx, 1)
    }
    planned.push({
      kind: 'upsert',
      taskId: task.id,
      title: task.title,
      resource: eventResource(task, userId, guests),
      match,
    })
  }

  for (const orphan of unusedDay) {
    planned.push({
      kind: 'remove',
      taskId: orphan.taskId,
      title: 'Previously synced event',
      event: orphan,
    })
  }

  type OpOutcome =
    | { kind: 'removed'; event: PushedEvent }
    | { kind: 'updated'; event: PushedEvent }
    | { kind: 'created'; event: PushedEvent; forgotMatch?: PushedEvent }
    | {
        kind: 'failure'
        failure: SyncTaskFailure
        forget?: PushedEvent
      }

  const outcomes = await mapPool(
    planned,
    CALENDAR_API_CONCURRENCY,
    async (op): Promise<OpOutcome> => {
      const outcome = await (async (): Promise<OpOutcome> => {
        if (op.kind === 'remove') {
          try {
            const stillThere = await isActiveCalendarEvent(
              calendarId,
              op.event.eventId,
            )
            if (stillThere) {
              await gapi.client.calendar.events.delete({
                calendarId,
                eventId: op.event.eventId,
                sendUpdates: 'none',
              })
            }
            return { kind: 'removed', event: op.event }
          } catch (err) {
            if (isNotFoundError(err)) {
              return { kind: 'removed', event: op.event }
            }
            return {
              kind: 'failure',
              failure: {
                taskId: op.taskId,
                title: op.title,
                action: 'remove',
                message: formatError(err),
              },
            }
          }
        }

        const { match, resource, taskId, title } = op
        if (match) {
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
                  sendUpdates: 'none',
                  resource,
                })
                return {
                  kind: 'updated',
                  event: {
                    calendarId,
                    eventId: match.eventId,
                    taskId,
                    groupId,
                    dayKey,
                    pushedAt: new Date().toISOString(),
                  },
                }
              } catch (err) {
                if (!isNotFoundError(err)) {
                  return {
                    kind: 'failure',
                    failure: {
                      taskId,
                      title,
                      action: 'update',
                      message: formatError(err),
                    },
                  }
                }
              }
            }
            // Event gone — fall through to create after forgetting the stale row.
          } catch (err) {
            return {
              kind: 'failure',
              failure: {
                taskId,
                title,
                action: 'update',
                message: formatError(err),
              },
            }
          }
        }

        try {
          const res = await gapi.client.calendar.events.insert({
            calendarId,
            sendUpdates: 'none',
            resource,
          })
          const eventId = res.result.id
          if (!eventId) {
            throw new Error('Google Calendar did not return an event id')
          }
          return {
            kind: 'created',
            event: {
              calendarId,
              eventId,
              taskId,
              groupId,
              dayKey,
              pushedAt: new Date().toISOString(),
            },
            forgotMatch: match ?? undefined,
          }
        } catch (err) {
          return {
            kind: 'failure',
            failure: {
              taskId,
              title,
              action: 'create',
              message: formatError(err),
            },
            forget: match ?? undefined,
          }
        }
      })()

      if (outcome.kind === 'removed') tick('Removing')
      else if (outcome.kind === 'updated') tick('Updating')
      else if (outcome.kind === 'created') tick('Adding')
      else {
        tick(
          outcome.failure.action === 'remove'
            ? 'Removing'
            : outcome.failure.action === 'create'
              ? 'Adding'
              : 'Updating',
        )
      }
      return outcome
    },
  )

  // Apply tracking updates in plan order after concurrent API calls finish.
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

  for (const outcome of outcomes) {
    if (outcome.kind === 'removed') {
      forgetTracked(outcome.event)
      removed += 1
      continue
    }
    if (outcome.kind === 'updated') {
      upsertTracked(outcome.event)
      updated += 1
      continue
    }
    if (outcome.kind === 'created') {
      if (outcome.forgotMatch) forgetTracked(outcome.forgotMatch)
      upsertTracked(outcome.event)
      created += 1
      continue
    }
    if (outcome.forget) forgetTracked(outcome.forget)
    failures.push(outcome.failure)
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
  successfulCalendarIds: string[]
}

/** Sync a group to multiple calendars; delete from deselected calendars. */
export async function syncGroupToCalendars(
  calendarIds: string[],
  groupId: string,
  tasks: Task[],
  anchor: StackAnchor,
  pushedEvents: PushedEvent[],
  userId?: string | null,
  onProgress?: SyncProgressCallback,
  guestsByCalendar: Record<string, CalendarGuest[]> = {},
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

  let totalOps = 0
  for (const calendarId of removedCalendarIds) {
    totalOps += pushedEvents.filter(
      (e) =>
        e.groupId === groupId &&
        e.dayKey === dayKey &&
        e.calendarId === calendarId,
    ).length
  }
  for (const calendarId of calendarIds) {
    totalOps += countTasksSyncOps(
      calendarId,
      groupId,
      tasks,
      anchor,
      pushedEvents,
    )
  }

  const tick = makeProgressTicker(totalOps, onProgress)

  let updated = 0
  let created = 0
  let removed = 0
  const failures: SyncTaskFailure[] = []
  const pushSnapshots: PushSnapshot[] = []
  let tracked = [...pushedEvents]

  const removeResults = await Promise.all(
    removedCalendarIds.map((calendarId) =>
      deleteGroupFromCalendarOnCalendar(
        groupId,
        dayKey,
        calendarId,
        pushedEvents,
        () => tick('Removing'),
      ),
    ),
  )
  for (let i = 0; i < removedCalendarIds.length; i++) {
    const calendarId = removedCalendarIds[i]!
    const result = removeResults[i]!
    tracked = replaceCalendarDayEvents(
      tracked,
      calendarId,
      groupId,
      dayKey,
      result.pushedEvents,
    )
    removed += result.removed
    failures.push(...result.failures)
  }

  const syncBase = tracked
  const syncResults = await Promise.all(
    calendarIds.map((calendarId) =>
      syncTasksToCalendar(
        calendarId,
        groupId,
        tasks,
        anchor,
        syncBase,
        userId,
        undefined,
        tick,
        guestsByCalendar[calendarId] ?? [],
      ),
    ),
  )
  const successfulCalendarIds: string[] = []
  for (let i = 0; i < calendarIds.length; i++) {
    const calendarId = calendarIds[i]!
    const result = syncResults[i]!
    tracked = replaceCalendarDayEvents(
      tracked,
      calendarId,
      groupId,
      dayKey,
      result.pushedEvents,
    )
    updated += result.updated
    created += result.created
    removed += result.removed
    failures.push(...result.failures)
    if (result.failures.length === 0) successfulCalendarIds.push(calendarId)
    if (result.pushSnapshot) {
      pushSnapshots.push(result.pushSnapshot)
    }
  }

  return {
    updated,
    created,
    removed,
    failures,
    pushedEvents: prunePushedEvents(tracked),
    pushSnapshots,
    removedCalendarIds,
    successfulCalendarIds,
  }
}

/** Delete pushed events for this group/day on one calendar. */
export async function deleteGroupFromCalendarOnCalendar(
  groupId: string,
  dayKey: string,
  calendarId: string,
  pushedEvents: PushedEvent[],
  onOp?: () => void,
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

  const outcomes = await mapPool(
    toDelete,
    CALENDAR_API_CONCURRENCY,
    async (event) => {
      try {
        const stillThere = await isActiveCalendarEvent(
          event.calendarId,
          event.eventId,
        )
        if (stillThere) {
          await gapi.client.calendar.events.delete({
            calendarId: event.calendarId,
            eventId: event.eventId,
            sendUpdates: 'none',
          })
        }
        onOp?.()
        return { ok: true as const, event }
      } catch (err) {
        onOp?.()
        if (isNotFoundError(err)) {
          return { ok: true as const, event }
        }
        return {
          ok: false as const,
          event,
          failure: {
            taskId: event.taskId,
            title: 'Calendar event',
            action: 'remove' as const,
            message: formatError(err),
          },
        }
      }
    },
  )

  for (const outcome of outcomes) {
    if (outcome.ok) {
      forgetTracked(outcome.event)
      removed += 1
    } else {
      failures.push(outcome.failure)
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
  onProgress?: SyncProgressCallback,
): Promise<DeleteFromCalendarResult> {
  const toDelete = pushedEvents.filter(
    (e) => e.groupId === groupId && e.dayKey === dayKey,
  )
  const tick = makeProgressTicker(toDelete.length, onProgress)
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

  const outcomes = await mapPool(
    toDelete,
    CALENDAR_API_CONCURRENCY,
    async (event) => {
      try {
        const stillThere = await isActiveCalendarEvent(
          event.calendarId,
          event.eventId,
        )
        if (stillThere) {
          await gapi.client.calendar.events.delete({
            calendarId: event.calendarId,
            eventId: event.eventId,
            sendUpdates: 'none',
          })
        }
        tick('Removing')
        return { ok: true as const, event }
      } catch (err) {
        tick('Removing')
        if (isNotFoundError(err)) {
          return { ok: true as const, event }
        }
        return {
          ok: false as const,
          event,
          failure: {
            taskId: event.taskId,
            title: 'Calendar event',
            action: 'remove' as const,
            message: formatError(err),
          },
        }
      }
    },
  )

  for (const outcome of outcomes) {
    if (outcome.ok) {
      forgetTracked(outcome.event)
      removed += 1
    } else {
      failures.push(outcome.failure)
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
