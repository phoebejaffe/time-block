import { useMemo, useRef, useState } from 'react'
import { AuthButton } from './components/AuthButton'
import { CalendarView } from './components/CalendarView'
import { MobileSplitHandle } from './components/MobileSplitHandle'
import { NoticeToast } from './components/NoticeToast'
import { SidebarResizeHandle } from './components/SidebarResizeHandle'
import { TaskSidebar } from './components/TaskSidebar'
import { useCalendarEvents } from './hooks/useCalendarEvents'
import { useGoogleSession } from './hooks/useGoogleSession'
import { useMobileSplit } from './hooks/useMobileSplit'
import { useNotice } from './hooks/useNotice'
import { usePlan } from './hooks/usePlan'
import { useSidebarWidth } from './hooks/useSidebarWidth'
import { useUserData } from './hooks/useUserData'
import { syncTasksToCalendar } from './lib/calendarApi'
import { isFirebaseConfigured } from './lib/firebase'
import { formatError } from './lib/errors'
import { ensureWriteScope } from './lib/google'
import { hasPushedGroupOnDay } from './lib/pushedEvents'
import {
  anchorOnDay,
  localDateKey,
  pickViewDate,
  shiftAnchor,
  startOfLocalDay,
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
  const userData = useUserData({
    signedIn: session.signedIn,
    plan: plan.plan,
    onRemotePlan: plan.replacePlan,
  })

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [commitBusy, setCommitBusy] = useState(false)
  const [viewDate, setViewDate] = useState(() => startOfLocalDay())
  const [stackDragPreview, setStackDragPreview] = useState<{
    groupId: string
    deltaMs: number
  } | null>(null)
  const appBodyRef = useRef<HTMLDivElement>(null)
  const { setSplitPercent, splitStyle } = useMobileSplit()
  const { setSidebarWidth, sidebarStyle } = useSidebarWidth()
  const bodyStyle = { ...splitStyle, ...sidebarStyle }

  const busy = session.busy || calendars.busy || commitBusy

  /** Anchors remapped onto the calendar's visible day (no drag preview). */
  const viewDayGroups = useMemo(
    () =>
      plan.plan.groups.map((group) => ({
        ...group,
        anchor: anchorOnDay(group.anchor, viewDate),
      })),
    [plan.plan.groups, viewDate],
  )

  /** Sidebar preview: view-day anchors plus live stack drag shift. */
  const displayGroups = useMemo(
    () =>
      viewDayGroups.map((group) =>
        stackDragPreview?.groupId === group.id
          ? {
              ...group,
              anchor: shiftAnchor(group.anchor, stackDragPreview.deltaMs),
            }
          : group,
      ),
    [viewDayGroups, stackDragPreview],
  )

  function handleDatesSet(start: Date, end: Date) {
    calendars.setDates(start, end)
    const next = pickViewDate(start, end)
    setViewDate((prev) =>
      prev.getTime() === next.getTime() ? prev : next,
    )
    setStackDragPreview(null)
  }

  async function handleSignIn() {
    clear()
    await session.signIn()
  }

  function handleSignOut() {
    if (!session.signOut()) return
    calendars.reset()
    plan.clear()
    userData.reset()
    clear()
  }

  function handleAddTask(groupId: string, input: Omit<Task, 'id'>) {
    plan.addTask(groupId, input)
    clear()
  }

  function handleRemoveTask(groupId: string, taskId: string) {
    const group = plan.plan.groups.find((g) => g.id === groupId)
    const index = group?.tasks.findIndex((t) => t.id === taskId) ?? -1
    const task = index >= 0 ? group!.tasks[index] : undefined
    if (!task) return

    plan.removeTask(groupId, taskId)
    if (editingTaskId === taskId) setEditingTaskId(null)

    show('info', 'Block deleted', {
      actionLabel: 'Undo',
      progressMs: 5_000,
      onAction: () => {
        plan.insertTaskAt(groupId, task, index)
        clear()
      },
    })
  }

  function handleReplaceTasks(groupId: string, tasks: Task[]) {
    plan.replaceTasks(groupId, tasks)
    clear()
  }

  function handleClearBlocks(groupId: string) {
    const group = plan.plan.groups.find((g) => g.id === groupId)
    if (!group || group.tasks.length === 0) return
    if (!window.confirm('Clear all blocks from this group?')) return
    plan.clearGroupTasks(groupId)
    setEditingTaskId(null)
    clear()
    show('info', 'Cleared blocks.')
  }

  function handleDeleteGroup(groupId: string) {
    if (plan.plan.groups.length <= 1) {
      show('info', 'Keep at least one block group.')
      return
    }
    if (!window.confirm('Delete this block group?')) return
    plan.removeGroup(groupId)
    setEditingTaskId(null)
    clear()
  }

  function handleAddGroup() {
    plan.addGroup()
    clear()
  }

  /** Returns true when the commit modal should close (full success). */
  async function handleCommit(
    groupId: string,
    calendarId: string,
  ): Promise<boolean> {
    const group = plan.plan.groups.find((g) => g.id === groupId)
    if (!group) return false
    const anchor = anchorOnDay(group.anchor, viewDate)
    const dayKey = localDateKey(anchor.at)
    const isUpdate = hasPushedGroupOnDay(groupId, dayKey)
    if (group.tasks.length === 0 && !isUpdate) {
      show('info', 'Add at least one block before adding to a calendar.')
      return false
    }

    setCommitBusy(true)
    session.setError(null)
    clear()
    try {
      await ensureWriteScope()
      // Persist the viewed day so the plan matches what we sync.
      if (group.anchor.at !== anchor.at) {
        plan.setAnchor(groupId, anchor)
      }
      const { updated, created, removed, failures } = await syncTasksToCalendar(
        calendarId,
        groupId,
        group.tasks,
        anchor,
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
      show('error', `Couldn't sync calendar: ${formatError(err)}`)
      return false
    } finally {
      setCommitBusy(false)
    }
  }

  const missingClientId =
    !import.meta.env.VITE_GOOGLE_CLIENT_ID ||
    String(import.meta.env.VITE_GOOGLE_CLIENT_ID).includes('your-client-id')
  const missingFirebase = !isFirebaseConfigured()

  return (
    <div className="app">
      {(session.error ||
        userData.syncError ||
        missingClientId ||
        missingFirebase) && (
        <div className="banner banner-error" role="alert">
          {missingClientId
            ? 'Set VITE_GOOGLE_CLIENT_ID in a .env file (see README), then restart the dev server.'
            : missingFirebase
              ? 'Set VITE_FIREBASE_* vars in .env (see README), then restart the dev server.'
              : session.error || userData.syncError}
        </div>
      )}

      {!session.ready || (session.signedIn && userData.loading) ? (
        <div className="app-gate">
          <div className="empty-state">
            <span className="spinner" aria-hidden />
            <p>Loading your plan…</p>
          </div>
        </div>
      ) : !session.signedIn ? (
        <div className="app-gate">
          <div className="empty-state">
            <h2>Your day, blocked out</h2>
            <p>
              Sign in with Google to overlay your calendars, then draft
              morning blocks that end when you need to leave. Your plan syncs
              to your Google account, so sign in is required to use it.
            </p>
            <AuthButton
              signedIn={false}
              busy={busy || missingClientId || missingFirebase}
              onSignIn={() => void handleSignIn()}
              onSignOut={handleSignOut}
            />
          </div>
        </div>
      ) : (
        <div className="app-body" ref={appBodyRef} style={bodyStyle}>
          <TaskSidebar
            groups={displayGroups}
            canDeleteGroup={plan.plan.groups.length > 1}
            writableCalendars={calendars.writableCalendars}
            onAdd={handleAddTask}
            onUpdate={plan.updateTask}
            onRemove={handleRemoveTask}
            onReorder={plan.reorderTasks}
            onAnchorChange={(groupId, next) => {
              setStackDragPreview(null)
              plan.setAnchor(groupId, next)
            }}
            onReplaceTasks={handleReplaceTasks}
            onClear={handleClearBlocks}
            onDeleteGroup={handleDeleteGroup}
            onAddGroup={handleAddGroup}
            onHideGroup={(groupId, name) => {
              plan.setGroupHidden(groupId, true, name)
            }}
            onShowGroup={(groupId) => {
              plan.setGroupHidden(groupId, false)
            }}
            onCommit={handleCommit}
            editingId={editingTaskId}
            onEditingIdChange={setEditingTaskId}
            busy={busy}
            signedIn={session.signedIn}
            onSignIn={() => void handleSignIn()}
            onSignOut={handleSignOut}
            savedLists={userData.savedLists}
            targetCalendarId={userData.targetCalendarId}
            onSaveList={userData.saveList}
            onDeleteList={userData.deleteList}
            onTargetCalendarChange={userData.setTargetCalendarId}
          />

          <SidebarResizeHandle
            bodyRef={appBodyRef}
            onWidthChange={setSidebarWidth}
          />

          <MobileSplitHandle
            bodyRef={appBodyRef}
            onSplitChange={setSplitPercent}
          />

          <main className="main-panel">
            <CalendarView
              googleEvents={calendars.googleEvents}
              calendars={calendars.calendars}
              visibleCalendarIds={calendars.visibleIds}
              onToggleCalendar={calendars.toggleCalendar}
              groups={viewDayGroups}
              onDatesSet={handleDatesSet}
              onAnchorCommit={(groupId, next) => {
                setStackDragPreview(null)
                plan.setAnchor(groupId, next)
              }}
              onStackShiftPreview={(groupId, deltaMs) => {
                if (groupId == null || deltaMs == null) {
                  setStackDragPreview(null)
                  return
                }
                setStackDragPreview({ groupId, deltaMs })
              }}
              onTaskClick={setEditingTaskId}
              busy={busy}
            />
          </main>
        </div>
      )}

      {notice && <NoticeToast notice={notice} />}
    </div>
  )
}
