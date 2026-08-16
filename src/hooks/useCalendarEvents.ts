import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  calendarsWritable,
  listCalendars,
  listEvents,
  type CalendarEvent,
  type GoogleCalendar,
} from '../lib/calendarApi'
import { formatError } from '../lib/errors'

type UseCalendarEventsOptions = {
  signedIn: boolean
  onError?: (message: string) => void
}

export function useCalendarEvents({
  signedIn,
  onError,
}: UseCalendarEventsOptions) {
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([])
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set())
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>([])
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null)
  const [busy, setBusy] = useState(false)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const writableCalendars = useMemo(
    () => calendarsWritable(calendars),
    [calendars],
  )

  const reset = useCallback(() => {
    setCalendars([])
    setVisibleIds(new Set())
    setGoogleEvents([])
  }, [])

  const refreshCalendars = useCallback(async () => {
    const list = await listCalendars()
    setCalendars(list)
    setVisibleIds((prev) => {
      if (prev.size > 0) {
        const next = new Set(
          [...prev].filter((id) => list.some((c) => c.id === id)),
        )
        if (next.size > 0) return next
      }
      const initial = list
        .filter((c) => c.selected || c.primary)
        .map((c) => c.id)
      if (initial.length === 0 && list[0]) return new Set([list[0].id])
      return new Set(initial)
    })
  }, [])

  const refreshEvents = useCallback(async () => {
    if (!signedIn || !range || visibleIds.size === 0) {
      setGoogleEvents([])
      return
    }
    const colorById = new Map(
      calendars.map((c) => [c.id, c.backgroundColor] as const),
    )
    const batches = await Promise.all(
      [...visibleIds].map((id) =>
        listEvents(
          id,
          range.start,
          range.end,
          colorById.get(id) ?? '#4285f4',
        ),
      ),
    )
    setGoogleEvents(batches.flat())
  }, [signedIn, range, visibleIds, calendars])

  useEffect(() => {
    if (!signedIn) return
    let cancelled = false
    ;(async () => {
      try {
        setBusy(true)
        await refreshCalendars()
      } catch (err) {
        if (!cancelled) {
          onErrorRef.current?.(formatError(err))
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [signedIn, refreshCalendars])

  useEffect(() => {
    if (!signedIn) return
    let cancelled = false
    ;(async () => {
      try {
        await refreshEvents()
      } catch (err) {
        if (!cancelled) {
          onErrorRef.current?.(formatError(err))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [signedIn, refreshEvents])

  const toggleCalendar = useCallback((calendarId: string) => {
    setVisibleIds((prev) => {
      const next = new Set(prev)
      if (next.has(calendarId)) next.delete(calendarId)
      else next.add(calendarId)
      return next
    })
  }, [])

  /** Drop ids from the visible set (e.g. when Settings hides calendars). */
  const omitVisibleIds = useCallback((ids: Iterable<string>) => {
    const hide = new Set(ids)
    if (hide.size === 0) return
    setVisibleIds((prev) => {
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (hide.has(id)) {
          changed = true
          continue
        }
        next.add(id)
      }
      return changed ? next : prev
    })
  }, [])

  const setDates = useCallback((start: Date, end: Date) => {
    setRange((prev) => {
      if (
        prev &&
        prev.start.getTime() === start.getTime() &&
        prev.end.getTime() === end.getTime()
      ) {
        return prev
      }
      return { start, end }
    })
  }, [])

  return {
    calendars,
    visibleIds,
    googleEvents,
    writableCalendars,
    busy,
    toggleCalendar,
    omitVisibleIds,
    setDates,
    refreshEvents,
    reset,
  }
}
