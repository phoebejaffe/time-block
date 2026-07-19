import { useState } from 'react'
import { AuthButton } from './components/AuthButton'
import { CalendarView } from './components/CalendarView'
import { TaskSidebar } from './components/TaskSidebar'
import { useCalendarEvents } from './hooks/useCalendarEvents'
import { useGoogleSession } from './hooks/useGoogleSession'
import { useNotice } from './hooks/useNotice'
import { usePlan } from './hooks/usePlan'
import { insertTasksAsEvents } from './lib/calendarApi'
import { ensureWriteScope } from './lib/google'
import {
  formatLocalDate,
  hasCommittedOnDay,
  localDateKey,
  markCommittedDay,
  type Task,
} from './lib/tasks'

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

  const busy = session.busy || calendars.busy || commitBusy

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

  async function handleCommit(calendarId: string) {
    if (plan.plan.tasks.length === 0) {
      show('info', 'Add at least one block before adding to a calendar.')
      return
    }

    const dayKey = localDateKey(plan.plan.anchor.at)
    if (dayKey && hasCommittedOnDay(dayKey)) {
      const ok = window.confirm(
        `You've already added a block list to the calendar for ${formatLocalDate(plan.plan.anchor.at)}. Add another anyway?`,
      )
      if (!ok) return
    }

    setCommitBusy(true)
    session.setError(null)
    clear()
    try {
      await ensureWriteScope()
      const { inserted } = await insertTasksAsEvents(
        calendarId,
        plan.plan.tasks,
        plan.plan.anchor,
      )
      if (dayKey) markCommittedDay(dayKey)
      await calendars.refreshEvents()
      show(
        'success',
        `Added ${inserted} event${inserted === 1 ? '' : 's'} to Google Calendar.`,
      )
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      show('error', `Couldn't add to calendar: ${text}`)
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

      <div className="app-body">
        <TaskSidebar
          tasks={plan.plan.tasks}
          anchor={plan.plan.anchor}
          writableCalendars={calendars.writableCalendars}
          onAdd={handleAddTask}
          onUpdate={plan.updateTask}
          onRemove={plan.removeTask}
          onReorder={plan.reorderTasks}
          onAnchorChange={plan.setAnchor}
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
              onStackShift={plan.shiftStack}
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
