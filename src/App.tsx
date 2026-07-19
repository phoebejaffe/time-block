import { useMemo, useRef, useState } from 'react'
import { AuthButton } from './components/AuthButton'
import { CalendarView } from './components/CalendarView'
import { MobileSplitHandle } from './components/MobileSplitHandle'
import { TaskSidebar } from './components/TaskSidebar'
import { useCalendarEvents } from './hooks/useCalendarEvents'
import { useGoogleSession } from './hooks/useGoogleSession'
import { useMobileSplit } from './hooks/useMobileSplit'
import { useNotice } from './hooks/useNotice'
import { usePlan } from './hooks/usePlan'
import { syncTasksToCalendar } from './lib/calendarApi'
import { ensureWriteScope } from './lib/google'
import { shiftAnchor, type Task } from './lib/tasks'

export default function App() {
  const { notice, show, clear } = useNotice()
  const session = useGoogleSession()
  const plan = usePlan()
  const calendars = useCalendarEvents({
    signedIn: session.signedIn,
    onError: (message) => session.setError(message),
  })

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [commitBusy, setCommitBusy] = useState(false)
  const [stackDragDeltaMs, setStackDragDeltaMs] = useState<number | null>(null)
  const appBodyRef = useRef<HTMLDivElement>(null)
  const { setSplitPercent, splitStyle } = useMobileSplit()

  const busy = session.busy || calendars.busy || commitBusy
  const sidebarAnchor = useMemo(
    () =>
      stackDragDeltaMs != null
        ? shiftAnchor(plan.plan.anchor, stackDragDeltaMs)
        : plan.plan.anchor,
    [plan.plan.anchor, stackDragDeltaMs],
  )

  async function handleSignIn() {
    clear()
    await session.signIn()
  }

  function handleSignOut() {
    if (!session.signOut()) return
    calendars.reset()
    clear()
  }

  function handleAddTask(input: Omit<Task, 'id'>) {
    plan.addTask(input)
    clear()
  }

  function handleReplaceTasks(tasks: Task[]) {
    plan.replaceTasks(tasks)
    clear()
  }

  function handleClearBlocks() {
    if (plan.plan.tasks.length === 0) return
    if (!window.confirm('Clear all blocks from this list?')) return
    plan.clear()
    setEditingTaskId(null)
    clear()
    show('info', 'Cleared blocks.')
  }

  /** Returns true when the commit modal should close (full success). */
  async function handleCommit(calendarId: string): Promise<boolean> {
    if (plan.plan.tasks.length === 0) {
      show('info', 'Add at least one block before adding to a calendar.')
      return false
    }

    setCommitBusy(true)
    session.setError(null)
    clear()
    try {
      await ensureWriteScope()
      const { updated, created, removed, failures } = await syncTasksToCalendar(
        calendarId,
        plan.plan.tasks,
        plan.plan.anchor,
      )
      await calendars.refreshEvents()

      if (failures.length > 0) {
        const detail = failures
          .map((f) => `“${f.title}” (${f.action}): ${f.message}`)
          .join(' · ')
        const okParts: string[] = []
        if (updated) okParts.push(`updated ${updated}`)
        if (created) okParts.push(`added ${created}`)
        if (removed) okParts.push(`removed ${removed}`)
        const prefix =
          okParts.length > 0
            ? `Partly synced (${okParts.join(', ')}). Failed: `
            : "Couldn't sync some events: "
        show('error', `${prefix}${detail}`)
        return false
      }

      const parts: string[] = []
      if (updated) parts.push(`updated ${updated}`)
      if (created) parts.push(`added ${created}`)
      if (removed) parts.push(`removed ${removed}`)
      show(
        'success',
        parts.length > 0
          ? `Calendar sync: ${parts.join(', ')}.`
          : 'Calendar already up to date.',
      )
      return true
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      show('error', `Couldn't sync calendar: ${text}`)
      return false
    } finally {
      setCommitBusy(false)
    }
  }

  const missingClientId =
    !import.meta.env.VITE_GOOGLE_CLIENT_ID ||
    String(import.meta.env.VITE_GOOGLE_CLIENT_ID).includes('your-client-id')

  return (
    <div className="app">
      {(session.error || missingClientId) && (
        <div className="banner banner-error" role="alert">
          {missingClientId
            ? 'Set VITE_GOOGLE_CLIENT_ID in a .env file (see README), then restart the dev server.'
            : session.error}
        </div>
      )}

      <div className="app-body" ref={appBodyRef} style={splitStyle}>
        <TaskSidebar
          tasks={plan.plan.tasks}
          anchor={sidebarAnchor}
          writableCalendars={calendars.writableCalendars}
          onAdd={handleAddTask}
          onUpdate={plan.updateTask}
          onRemove={plan.removeTask}
          onReorder={plan.reorderTasks}
          onAnchorChange={(next) => {
            setStackDragDeltaMs(null)
            plan.setAnchor(next)
          }}
          onReplaceTasks={handleReplaceTasks}
          onClear={handleClearBlocks}
          onCommit={handleCommit}
          editingId={editingTaskId}
          onEditingIdChange={setEditingTaskId}
          busy={busy}
          notice={notice}
          signedIn={session.signedIn}
          onSignOut={handleSignOut}
        />

        <MobileSplitHandle
          bodyRef={appBodyRef}
          onSplitChange={setSplitPercent}
        />

        <main className="main-panel">
          {!session.signedIn ? (
            <div className="empty-state">
              <h2>Your day, blocked out</h2>
              <p>
                Sign in with Google to overlay your calendars, then draft local
                morning blocks that end when you need to leave.
              </p>
              <AuthButton
                signedIn={false}
                busy={busy || !session.ready || missingClientId}
                onSignIn={() => void handleSignIn()}
                onSignOut={handleSignOut}
              />
            </div>
          ) : (
            <CalendarView
              googleEvents={calendars.googleEvents}
              calendars={calendars.calendars}
              visibleCalendarIds={calendars.visibleIds}
              onToggleCalendar={calendars.toggleCalendar}
              tasks={plan.plan.tasks}
              anchor={plan.plan.anchor}
              onDatesSet={calendars.setDates}
              onStackShift={(deltaMs) => {
                setStackDragDeltaMs(null)
                plan.shiftStack(deltaMs)
              }}
              onStackShiftPreview={setStackDragDeltaMs}
              onTaskDurationChange={plan.setTaskDuration}
              onSelectSlot={plan.addFromSlot}
              onTaskClick={setEditingTaskId}
              busy={busy}
            />
          )}
        </main>
      </div>
    </div>
  )
}
