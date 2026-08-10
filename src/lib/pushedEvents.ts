/** Keep about one month of push history. */
const RETAIN_MS = 31 * 24 * 60 * 60 * 1000

const LEGACY_EVENTS_KEY = 'time-blocking.pushed-events'
const LEGACY_SNAPSHOTS_KEY = 'time-blocking.pushed-snapshots'

export const TIMEBLOCK_EVENT_DESCRIPTION = 'Added with love, by Timeblock'

export type PushedEvent = {
  calendarId: string
  eventId: string
  taskId: string
  groupId: string
  dayKey: string
  pushedAt: string
}

export type PushSnapshot = {
  calendarId: string
  groupId: string
  dayKey: string
  fingerprint: string
  savedAt: string
}

export function prunePushedEvents(
  events: PushedEvent[],
  now = Date.now(),
): PushedEvent[] {
  const cutoff = now - RETAIN_MS
  return events.filter((e) => {
    const t = new Date(e.pushedAt).getTime()
    return Number.isFinite(t) && t >= cutoff
  })
}

function prunePushSnapshots(
  snapshots: PushSnapshot[],
  now = Date.now(),
): PushSnapshot[] {
  const cutoff = now - RETAIN_MS
  return snapshots.filter((s) => {
    const t = new Date(s.savedAt).getTime()
    return Number.isFinite(t) && t >= cutoff
  })
}

function parsePushedEvent(item: unknown): PushedEvent | null {
  if (
    !item ||
    typeof item !== 'object' ||
    typeof (item as PushedEvent).calendarId !== 'string' ||
    typeof (item as PushedEvent).eventId !== 'string' ||
    typeof (item as PushedEvent).taskId !== 'string' ||
    typeof (item as PushedEvent).dayKey !== 'string' ||
    typeof (item as PushedEvent).pushedAt !== 'string'
  ) {
    return null
  }
  const groupId =
    typeof (item as PushedEvent).groupId === 'string'
      ? (item as PushedEvent).groupId
      : ''
  return {
    calendarId: (item as PushedEvent).calendarId,
    eventId: (item as PushedEvent).eventId,
    taskId: (item as PushedEvent).taskId,
    groupId,
    dayKey: (item as PushedEvent).dayKey,
    pushedAt: (item as PushedEvent).pushedAt,
  }
}

function parsePushSnapshot(item: unknown): PushSnapshot | null {
  if (
    !item ||
    typeof item !== 'object' ||
    typeof (item as PushSnapshot).calendarId !== 'string' ||
    typeof (item as PushSnapshot).dayKey !== 'string' ||
    typeof (item as PushSnapshot).fingerprint !== 'string' ||
    typeof (item as PushSnapshot).savedAt !== 'string'
  ) {
    return null
  }
  const groupId =
    typeof (item as PushSnapshot).groupId === 'string'
      ? (item as PushSnapshot).groupId
      : ''
  return {
    calendarId: (item as PushSnapshot).calendarId,
    groupId,
    dayKey: (item as PushSnapshot).dayKey,
    fingerprint: (item as PushSnapshot).fingerprint,
    savedAt: (item as PushSnapshot).savedAt,
  }
}

export function normalizePushedEvents(raw: unknown): PushedEvent[] {
  if (!Array.isArray(raw)) return []
  const events = raw
    .map(parsePushedEvent)
    .filter((e): e is PushedEvent => e != null)
  return prunePushedEvents(events)
}

export function normalizePushSnapshots(raw: unknown): PushSnapshot[] {
  if (!Array.isArray(raw)) return []
  const snapshots = raw
    .map(parsePushSnapshot)
    .filter((s): s is PushSnapshot => s != null)
  return prunePushSnapshots(snapshots)
}

/** One-time migration from pre-Firestore localStorage. */
export function loadLegacyPushedEvents(): PushedEvent[] {
  try {
    const raw = localStorage.getItem(LEGACY_EVENTS_KEY)
    if (!raw) return []
    return normalizePushedEvents(JSON.parse(raw) as unknown)
  } catch {
    return []
  }
}

/** One-time migration from pre-Firestore localStorage. */
export function loadLegacyPushSnapshots(): PushSnapshot[] {
  try {
    const raw = localStorage.getItem(LEGACY_SNAPSHOTS_KEY)
    if (!raw) return []
    return normalizePushSnapshots(JSON.parse(raw) as unknown)
  } catch {
    return []
  }
}

/** True when we already pushed this group to this calendar on this day. */
export function canUpdateCalendar(
  events: PushedEvent[],
  calendarId: string,
  groupId: string,
  dayKey: string,
): boolean {
  if (!calendarId || !groupId || !dayKey) return false
  return events.some(
    (e) =>
      e.calendarId === calendarId &&
      e.groupId === groupId &&
      e.dayKey === dayKey,
  )
}

/** True when this group was pushed for this day on any calendar. */
export function hasPushedGroupOnDay(
  events: PushedEvent[],
  groupId: string,
  dayKey: string,
): boolean {
  if (!groupId || !dayKey) return false
  return events.some((e) => e.groupId === groupId && e.dayKey === dayKey)
}

/** True when this block was pushed for this day on any calendar. */
export function hasPushedTaskOnDay(
  events: PushedEvent[],
  taskId: string,
  dayKey: string,
): boolean {
  if (!taskId || !dayKey) return false
  return events.some((e) => e.taskId === taskId && e.dayKey === dayKey)
}

/** Calendar ids this group was pushed to on a given day. */
export function pushedCalendarIdsForGroupDay(
  events: PushedEvent[],
  groupId: string,
  dayKey: string,
): string[] {
  if (!groupId || !dayKey) return []
  return [
    ...new Set(
      events
        .filter((e) => e.groupId === groupId && e.dayKey === dayKey)
        .map((e) => e.calendarId),
    ),
  ]
}

/** Sidebar / commit CTA: Add to calendar / Update calendar(s). */
export function calendarCommitLabel(
  isUpdate: boolean,
  calendarCount: number,
): string {
  if (!isUpdate) return 'Add to calendar'
  return calendarCount > 1 ? 'Update calendars' : 'Update calendar'
}

/** True when this block matches what was last pushed for its group/day on every calendar. */
export function isTaskPushUnchanged(
  events: PushedEvent[],
  snapshots: PushSnapshot[],
  groupId: string,
  dayKey: string,
  task: { id: string; title: string; start: Date; end: Date },
): boolean {
  const pushes = events.filter(
    (e) =>
      e.taskId === task.id && e.groupId === groupId && e.dayKey === dayKey,
  )
  if (pushes.length === 0) return false

  return pushes.every((push) => {
    const snapshot = snapshots.find(
      (s) =>
        s.calendarId === push.calendarId &&
        s.groupId === groupId &&
        s.dayKey === dayKey,
    )
    if (!snapshot) return false

    try {
      const parsed = JSON.parse(snapshot.fingerprint) as {
        items?: [string, string, string, string][]
      }
      const item = parsed.items?.find(([id]) => id === task.id)
      if (!item) return false
      return (
        item[1] === task.title &&
        item[2] === task.start.toISOString() &&
        item[3] === task.end.toISOString()
      )
    } catch {
      return false
    }
  })
}

/** Stable fingerprint of what a sync would write for this stack. */
export function stackPushFingerprint(
  anchor: { kind: string; at: string },
  resolved: {
    id: string
    title: string
    start: Date
    end: Date
    empty?: boolean
    disabled?: boolean
  }[],
): string {
  return JSON.stringify({
    kind: anchor.kind,
    at: anchor.at,
    items: resolved
      .filter((t) => t.empty !== true && t.disabled !== true)
      .map((t) => [
      t.id,
      t.title,
      t.start.toISOString(),
      t.end.toISOString(),
    ]),
  })
}

/** Remember the stack last successfully pushed for this group/calendar/day. */
export function upsertPushSnapshot(
  snapshots: PushSnapshot[],
  calendarId: string,
  groupId: string,
  dayKey: string,
  fingerprint: string,
): PushSnapshot[] {
  if (!calendarId || !groupId || !dayKey) return snapshots
  const next: PushSnapshot = {
    calendarId,
    groupId,
    dayKey,
    fingerprint,
    savedAt: new Date().toISOString(),
  }
  const filtered = snapshots.filter(
    (s) =>
      !(
        s.groupId === groupId &&
        s.dayKey === dayKey &&
        s.calendarId === calendarId
      ),
  )
  return prunePushSnapshots([...filtered, next])
}

/** Remove synced state for one calendar on a group/day. */
export function clearGroupDayCalendarPushSnapshot(
  snapshots: PushSnapshot[],
  calendarId: string,
  groupId: string,
  dayKey: string,
): PushSnapshot[] {
  if (!calendarId || !groupId || !dayKey) return snapshots
  return snapshots.filter(
    (s) =>
      !(
        s.calendarId === calendarId &&
        s.groupId === groupId &&
        s.dayKey === dayKey
      ),
  )
}

/** Remove synced state for a group on a given day (after deleting from calendar). */
export function clearGroupDayPushSnapshots(
  snapshots: PushSnapshot[],
  groupId: string,
  dayKey: string,
): PushSnapshot[] {
  if (!groupId || !dayKey) return snapshots
  return snapshots.filter((s) => !(s.groupId === groupId && s.dayKey === dayKey))
}

/** True when an Update would write the same events as the last successful push. */
export function isPushUnchanged(
  snapshots: PushSnapshot[],
  calendarId: string,
  groupId: string,
  dayKey: string,
  fingerprint: string,
): boolean {
  if (!calendarId || !groupId || !dayKey || !fingerprint) return false
  return snapshots.some(
    (s) =>
      s.calendarId === calendarId &&
      s.groupId === groupId &&
      s.dayKey === dayKey &&
      s.fingerprint === fingerprint,
  )
}
