const STORAGE_KEY = 'time-blocking.pushed-events'
const SNAPSHOT_KEY = 'time-blocking.pushed-snapshots'
/** Keep about one month of push history. */
const RETAIN_MS = 31 * 24 * 60 * 60 * 1000

export const TIMEBLOCK_EVENT_DESCRIPTION = 'Added with love, by Timeblock'

export type PushedEvent = {
  calendarId: string
  eventId: string
  taskId: string
  groupId: string
  dayKey: string
  pushedAt: string
}

type PushSnapshot = {
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

export function loadPushedEvents(): PushedEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const events = parsed
      .map((item): PushedEvent | null => {
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
      })
      .filter((e): e is PushedEvent => e != null)
    return prunePushedEvents(events)
  } catch {
    return []
  }
}

export function savePushedEvents(events: PushedEvent[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(prunePushedEvents(events)),
    )
  } catch {
    /* ignore quota / private mode */
  }
}

/** True when we already pushed this group to this calendar on this day. */
export function canUpdateCalendar(
  calendarId: string,
  groupId: string,
  dayKey: string,
): boolean {
  if (!calendarId || !groupId || !dayKey) return false
  return loadPushedEvents().some(
    (e) =>
      e.calendarId === calendarId &&
      e.groupId === groupId &&
      e.dayKey === dayKey,
  )
}

/** Stable fingerprint of what a sync would write for this stack. */
export function stackPushFingerprint(
  anchor: { kind: string; at: string },
  resolved: { id: string; title: string; start: Date; end: Date }[],
): string {
  return JSON.stringify({
    kind: anchor.kind,
    at: anchor.at,
    items: resolved.map((t) => [
      t.id,
      t.title,
      t.start.toISOString(),
      t.end.toISOString(),
    ]),
  })
}

function loadPushSnapshots(): PushSnapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const now = Date.now()
    return parsed
      .map((item): PushSnapshot | null => {
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
        const t = new Date((item as PushSnapshot).savedAt).getTime()
        if (!Number.isFinite(t) || t < now - RETAIN_MS) return null
        return {
          calendarId: (item as PushSnapshot).calendarId,
          groupId,
          dayKey: (item as PushSnapshot).dayKey,
          fingerprint: (item as PushSnapshot).fingerprint,
          savedAt: (item as PushSnapshot).savedAt,
        }
      })
      .filter((s): s is PushSnapshot => s != null)
  } catch {
    return []
  }
}

/** Remember the stack last successfully pushed for this group/calendar/day. */
export function savePushSnapshot(
  calendarId: string,
  groupId: string,
  dayKey: string,
  fingerprint: string,
): void {
  if (!calendarId || !groupId || !dayKey) return
  const next: PushSnapshot = {
    calendarId,
    groupId,
    dayKey,
    fingerprint,
    savedAt: new Date().toISOString(),
  }
  const snapshots = loadPushSnapshots().filter(
    (s) =>
      !(
        s.calendarId === calendarId &&
        s.groupId === groupId &&
        s.dayKey === dayKey
      ),
  )
  snapshots.push(next)
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots))
  } catch {
    /* ignore quota / private mode */
  }
}

/** True when an Update would write the same events as the last successful push. */
export function isPushUnchanged(
  calendarId: string,
  groupId: string,
  dayKey: string,
  fingerprint: string,
): boolean {
  if (!calendarId || !groupId || !dayKey || !fingerprint) return false
  return loadPushSnapshots().some(
    (s) =>
      s.calendarId === calendarId &&
      s.groupId === groupId &&
      s.dayKey === dayKey &&
      s.fingerprint === fingerprint,
  )
}
