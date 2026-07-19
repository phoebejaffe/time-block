const STORAGE_KEY = 'time-blocking.pushed-events'
/** Keep about one month of push history. */
const RETAIN_MS = 31 * 24 * 60 * 60 * 1000

export const TIMEBLOCK_EVENT_DESCRIPTION = 'Added with love, by Timeblock'

export type PushedEvent = {
  calendarId: string
  eventId: string
  taskId: string
  dayKey: string
  pushedAt: string
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
    const events = parsed.filter(
      (item): item is PushedEvent =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as PushedEvent).calendarId === 'string' &&
        typeof (item as PushedEvent).eventId === 'string' &&
        typeof (item as PushedEvent).taskId === 'string' &&
        typeof (item as PushedEvent).dayKey === 'string' &&
        typeof (item as PushedEvent).pushedAt === 'string',
    )
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

/** True when we already pushed Timeblock events for this calendar on this day. */
export function canUpdateCalendar(
  calendarId: string,
  _taskIds: string[],
  dayKey: string,
): boolean {
  if (!calendarId || !dayKey) return false
  return loadPushedEvents().some(
    (e) => e.calendarId === calendarId && e.dayKey === dayKey,
  )
}
