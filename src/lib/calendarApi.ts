import type { Task } from './tasks'
import { resolveStack, type StackAnchor } from './tasks'

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

export async function insertTasksAsEvents(
  calendarId: string,
  tasks: Task[],
  anchor: StackAnchor,
): Promise<{ inserted: number; skipped: number }> {
  const resolved = resolveStack(tasks, anchor)
  if (resolved.length === 0) {
    return { inserted: 0, skipped: tasks.length }
  }

  let inserted = 0
  for (const task of resolved) {
    await gapi.client.calendar.events.insert({
      calendarId,
      resource: {
        summary: task.title,
        start: { dateTime: task.start.toISOString() },
        end: { dateTime: task.end.toISOString() },
      },
    })
    inserted += 1
  }

  return { inserted, skipped: 0 }
}

export function calendarsWritable(calendars: GoogleCalendar[]): GoogleCalendar[] {
  return calendars.filter(
    (c) => c.accessRole === 'owner' || c.accessRole === 'writer',
  )
}
