import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  calendarsWritable,
  listCalendars,
  listEvents,
  type CalendarEvent,
  type GoogleCalendar,
} from '../lib/calendarApi'
import { formatError } from '../lib/errors'
import {
  googleDefaultVisibleCalendarIds,
  pruneVisibleCalendarIds,
  sameCalendarIdSet,
} from '../lib/userSettings'

type UseCalendarEventsOptions = {
  signedIn: boolean
  onError?: (message: string) => void
  hiddenIds?: Set<string>
  storedVisibleIds?: string[]
  settingsReady?: boolean
  onStoredVisibleIdsChange?: (ids: string[]) => void
}

export function useCalendarEvents({
  signedIn,
  onError,
  hiddenIds = new Set(),
  storedVisibleIds,
  settingsReady = false,
  onStoredVisibleIdsChange,
}: UseCalendarEventsOptions) {
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([])
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set())
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>([])
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null)
  const [busy, setBusy] = useState(false)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const persistVisibleRef = useRef(onStoredVisibleIdsChange)
  persistVisibleRef.current = onStoredVisibleIdsChange
  const hiddenIdsRef = useRef(hiddenIds)
  hiddenIdsRef.current = hiddenIds

  const writableCalendars = useMemo(
    () => calendarsWritable(calendars),
    [calendars],
  )

  const overlayIds = useMemo(() => {
    const next = new Set<string>()
    for (const id of visibleIds) {
      if (!hiddenIds.has(id)) next.add(id)
    }
    return next
  }, [visibleIds, hiddenIds])

  const reset = useCallback(() => {
    setCalendars([])
    setVisibleIds(new Set())
    setGoogleEvents([])
  }, [])

  const refreshCalendars = useCallback(async () => {
    const list = await listCalendars()
    setCalendars(list)
  }, [])

  const refreshEvents = useCallback(async () => {
    if (!signedIn || !range || overlayIds.size === 0) {
      setGoogleEvents([])
      return
    }
    const colorById = new Map(
      calendars.map((c) => [c.id, c.backgroundColor] as const),
    )
    const batches = await Promise.all(
      [...overlayIds].map((id) =>
        listEvents(
          id,
          range.start,
          range.end,
          colorById.get(id) ?? '#4285f4',
        ),
      ),
    )
    setGoogleEvents(batches.flat())
  }, [signedIn, range, overlayIds, calendars])

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

  useEffect(() => {
    if (!signedIn || !settingsReady || calendars.length === 0) return
    const available = calendars.map((c) => c.id)
    if (storedVisibleIds) {
      const next = pruneVisibleCalendarIds(storedVisibleIds, available) ?? []
      setVisibleIds((prev) =>
        sameCalendarIdSet(prev, next) ? prev : new Set(next),
      )
      if (!sameCalendarIdSet(storedVisibleIds, next)) {
        persistVisibleRef.current?.(next)
      }
      return
    }
    const listed = calendars.filter((c) => !hiddenIdsRef.current.has(c.id))
    const seeded = googleDefaultVisibleCalendarIds(listed)
    setVisibleIds(new Set(seeded))
    persistVisibleRef.current?.(seeded)
  }, [signedIn, settingsReady, calendars, storedVisibleIds])

  const toggleCalendar = useCallback((calendarId: string) => {
    setVisibleIds((prev) => {
      const next = new Set(prev)
      if (next.has(calendarId)) next.delete(calendarId)
      else next.add(calendarId)
      persistVisibleRef.current?.([...next])
      return next
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
    setDates,
    refreshEvents,
    reset,
  }
}
