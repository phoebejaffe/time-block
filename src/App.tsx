import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuthButton } from './components/AuthButton'
import { CalendarToggles } from './components/CalendarToggles'
import { CalendarView } from './components/CalendarView'
import { TaskSidebar } from './components/TaskSidebar'
import {
  calendarsWritable,
  insertTasksAsEvents,
  listCalendars,
  listEvents,
  type CalendarEvent,
  type GoogleCalendar,
} from './lib/calendarApi'
import {
  ensureWriteScope,
  hasAccessToken,
  initGoogle,
  restoreSession,
  signIn,
  signOut,
} from './lib/google'
import {
  createTask,
  formatLocalDate,
  hasCommittedOnDay,
  loadPlan,
  localDateKey,
  markCommittedDay,
  savePlan,
  shiftAnchor,
  type Plan,
  type StackAnchor,
  type Task,
} from './lib/tasks'

export default function App() {
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{
    kind: 'success' | 'error' | 'info'
    text: string
  } | null>(null)

  const [calendars, setCalendars] = useState<GoogleCalendar[]>([])
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set())
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>([])
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null)

  const [plan, setPlan] = useState<Plan>(() => loadPlan())
  const [calendarsOpen, setCalendarsOpen] = useState(false)
  const calendarsMenuRef = useRef<HTMLDivElement>(null)

  const writableCalendars = useMemo(
    () => calendarsWritable(calendars),
    [calendars],
  )

  useEffect(() => {
    savePlan(plan)
  }, [plan])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await initGoogle()
        const restored = await restoreSession()
        if (cancelled) return
        setSignedIn(restored || hasAccessToken())
        setReady(true)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
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
        setError(null)
        await refreshCalendars()
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
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
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [signedIn, refreshEvents])

  async function handleSignIn() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await signIn()
      setSignedIn(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function handleSignOut() {
    if (!window.confirm('Sign out of Google?')) return
    signOut()
    setSignedIn(false)
    setCalendars([])
    setVisibleIds(new Set())
    setGoogleEvents([])
    setCalendarsOpen(false)
    setNotice(null)
    setError(null)
  }

  useEffect(() => {
    if (!calendarsOpen) return

    function handlePointerDown(event: MouseEvent) {
      const menu = calendarsMenuRef.current
      if (!menu) return
      if (event.target instanceof Node && !menu.contains(event.target)) {
        setCalendarsOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setCalendarsOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [calendarsOpen])

  function handleToggleCalendar(calendarId: string) {
    setVisibleIds((prev) => {
      const next = new Set(prev)
      if (next.has(calendarId)) next.delete(calendarId)
      else next.add(calendarId)
      return next
    })
  }

  function handleDatesSet(start: Date, end: Date) {
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
  }

  function updatePlan(updater: (prev: Plan) => Plan) {
    setPlan((prev) => updater(prev))
  }

  function handleAddTask(input: Omit<Task, 'id'>) {
    updatePlan((prev) => ({
      ...prev,
      tasks: [...prev.tasks, createTask(input)],
    }))
    setNotice(null)
  }

  function handleUpdateTask(task: Task) {
    updatePlan((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.id === task.id ? task : t)),
    }))
  }

  function handleRemoveTask(id: string) {
    updatePlan((prev) => ({
      ...prev,
      tasks: prev.tasks.filter((t) => t.id !== id),
    }))
  }

  function handleReorderTasks(fromIndex: number, toIndex: number) {
    updatePlan((prev) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.tasks.length ||
        toIndex >= prev.tasks.length
      ) {
        return prev
      }
      const tasks = [...prev.tasks]
      const [moved] = tasks.splice(fromIndex, 1)
      if (!moved) return prev
      tasks.splice(toIndex, 0, moved)
      return { ...prev, tasks }
    })
  }

  function handleAnchorChange(anchor: StackAnchor) {
    updatePlan((prev) => ({ ...prev, anchor }))
  }

  function handleReplaceTasks(tasks: Task[]) {
    updatePlan((prev) => ({ ...prev, tasks }))
    setNotice(null)
  }

  function handleStackShift(deltaMs: number) {
    updatePlan((prev) => ({
      ...prev,
      anchor: shiftAnchor(prev.anchor, deltaMs),
    }))
  }

  function handleTaskDurationChange(taskId: string, durationMinutes: number) {
    updatePlan((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) =>
        t.id === taskId
          ? { ...t, durationMinutes: Math.max(1, durationMinutes) }
          : t,
      ),
    }))
  }

  function handleSelectSlot(start: Date, end: Date) {
    const durationMinutes = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 60_000),
    )
    updatePlan((prev) => ({
      ...prev,
      tasks: [
        ...prev.tasks,
        createTask({ title: 'New block', durationMinutes }),
      ],
    }))
  }

  async function handleCommit(calendarId: string) {
    if (plan.tasks.length === 0) {
      setNotice({
        kind: 'info',
        text: 'Add at least one task before adding to a calendar.',
      })
      return
    }

    const dayKey = localDateKey(plan.anchor.at)
    if (dayKey && hasCommittedOnDay(dayKey)) {
      const ok = window.confirm(
        `You've already added a task list to the calendar for ${formatLocalDate(plan.anchor.at)}. Add another anyway?`,
      )
      if (!ok) return
    }

    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await ensureWriteScope()
      const { inserted } = await insertTasksAsEvents(
        calendarId,
        plan.tasks,
        plan.anchor,
      )
      if (dayKey) markCommittedDay(dayKey)
      await refreshEvents()
      setNotice({
        kind: 'success',
        text: `Added ${inserted} event${inserted === 1 ? '' : 's'} to Google Calendar.`,
      })
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      setNotice({
        kind: 'error',
        text: `Couldn't add to calendar: ${text}`,
      })
    } finally {
      setBusy(false)
    }
  }

  const missingClientId =
    !import.meta.env.VITE_GOOGLE_CLIENT_ID ||
    String(import.meta.env.VITE_GOOGLE_CLIENT_ID).includes('your-client-id')

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <h1>Timeblock</h1>
          </div>
        </div>

        <div className="header-actions">
          {signedIn && (
            <div className="calendars-menu" ref={calendarsMenuRef}>
              <button
                type="button"
                className="btn btn-text"
                aria-expanded={calendarsOpen}
                aria-haspopup="true"
                onClick={() => setCalendarsOpen((o) => !o)}
              >
                Calendars
              </button>
              {calendarsOpen && (
                <div className="calendars-dropdown" role="menu">
                  <CalendarToggles
                    calendars={calendars}
                    visibleIds={visibleIds}
                    onToggle={handleToggleCalendar}
                    disabled={busy}
                  />
                </div>
              )}
            </div>
          )}
          <AuthButton
            signedIn={signedIn}
            busy={busy || !ready}
            onSignIn={() => void handleSignIn()}
            onSignOut={handleSignOut}
          />
        </div>
      </header>

      {(error || missingClientId) && (
        <div className="banner banner-error" role="alert">
          {missingClientId
            ? 'Set VITE_GOOGLE_CLIENT_ID in a .env file (see README), then restart the dev server.'
            : error}
        </div>
      )}

      <div className="app-body">
        <TaskSidebar
          tasks={plan.tasks}
          anchor={plan.anchor}
          writableCalendars={writableCalendars}
          onAdd={handleAddTask}
          onUpdate={handleUpdateTask}
          onRemove={handleRemoveTask}
          onReorder={handleReorderTasks}
          onAnchorChange={handleAnchorChange}
          onReplaceTasks={handleReplaceTasks}
          onCommit={handleCommit}
          busy={busy}
          notice={notice}
        />

        <main className="main-panel">
          {!signedIn ? (
            <div className="empty-state">
              <h2>Your day, blocked out</h2>
              <p>
                Sign in with Google to overlay your calendars, then draft local
                morning blocks that end when you need to leave.
              </p>
              <AuthButton
                signedIn={false}
                busy={busy || !ready || missingClientId}
                onSignIn={() => void handleSignIn()}
                onSignOut={handleSignOut}
              />
            </div>
          ) : (
            <CalendarView
              googleEvents={googleEvents}
              tasks={plan.tasks}
              anchor={plan.anchor}
              onDatesSet={handleDatesSet}
              onStackShift={handleStackShift}
              onTaskDurationChange={handleTaskDurationChange}
              onSelectSlot={handleSelectSlot}
            />
          )}
        </main>
      </div>
    </div>
  )
}
