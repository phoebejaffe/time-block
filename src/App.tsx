import { useLayoutEffect, useMemo, useRef, useState, useCallback, useEffect } from 'react'
import { AuthButton } from './components/AuthButton'
import { AuthSessionDiagnostics } from './components/AuthSessionDiagnostics'
import { CalendarView } from './components/CalendarView'
import { ExecutionModal } from './components/ExecutionModal'
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
import { calendarNamesForPushedGroupDay, deleteGroupFromCalendar, syncGroupToCalendars, type SyncProgress } from './lib/calendarApi'
import { isFirebaseConfigured } from './lib/firebase'
import { formatError } from './lib/errors'
import { undoNoticeOptions } from './lib/notice'
import { ensureWriteScope } from './lib/google'
import { hasPushedGroupOnDay } from './lib/pushedEvents'
import {
  addArchivedPlan,
  archivedPlanFromGroup,
  removeArchivedPlan,
  type ArchivedPlan,
} from './lib/planArchive'
import {
  defaultAnchorFromSettings,
  defaultUserSettings,
  executionAutoEndAfterMs,
  hiddenCalendarIdSet,
  type UserSettings,
} from './lib/userSettings'
import {
  anchorOnDay,
  applyTaskEditPreview,
  executionAutoEndAt,
  isGroupEnabled,
  isTaskDelay,
  localDateKey,
  pickViewDate,
  shiftAnchor,
  shouldAutoEndExecution,
  startOfLocalDay,
  type CalendarGuest,
  type StackAnchor,
  type Task,
  type TaskEditPreview,
} from './lib/tasks'

export default function App() {
  const { notice, show, clear } = useNotice()
  const session = useGoogleSession()
  const settingsRef = useRef<UserSettings>(defaultUserSettings())
  const plan = usePlan({
    getDefaultAnchor: () => defaultAnchorFromSettings(settingsRef.current),
  })
  const userData = useUserData({
    signedIn: session.signedIn,
    plan: plan.plan,
    onRemotePlan: plan.replacePlan,
  })
  settingsRef.current = userData.settings
  const { setExecutingGroupId } = userData

  const hiddenIds = useMemo(
    () => hiddenCalendarIdSet(userData.settings),
    [userData.settings],
  )
  const calendars = useCalendarEvents({
    signedIn: session.signedIn,
    onError: (message) => session.setError(message),
    hiddenIds,
    storedVisibleIds: userData.settings.visibleCalendarIds,
    settingsReady: session.signedIn && !userData.loading,
    onStoredVisibleIdsChange: (ids) => {
      userData.patchSettings({ visibleCalendarIds: ids })
    },
  })

  const listedCalendars = useMemo(
    () => calendars.calendars.filter((c) => !hiddenIds.has(c.id)),
    [calendars.calendars, hiddenIds],
  )
  const listedWritableCalendars = useMemo(
    () => calendars.writableCalendars.filter((c) => !hiddenIds.has(c.id)),
    [calendars.writableCalendars, hiddenIds],
  )

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [commitBusy, setCommitBusy] = useState(false)
  const [commitProgress, setCommitProgress] = useState<SyncProgress | null>(null)
  const [viewDate, setViewDate] = useState(() => startOfLocalDay())
  const [executionModalOpen, setExecutionModalOpen] = useState(false)
  const [stackDragPreview, setStackDragPreview] = useState<{
    groupId: string
    deltaMs: number
  } | null>(null)
  const [taskEditPreview, setTaskEditPreview] = useState<TaskEditPreview | null>(
    null,
  )
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

  /** Sidebar + task-edit preview (includes live stack drag). */
  const previewGroups = useMemo(() => {
    let groups = viewDayGroups
    if (stackDragPreview) {
      groups = groups.map((group) =>
        stackDragPreview.groupId === group.id
          ? {
              ...group,
              anchor: shiftAnchor(group.anchor, stackDragPreview.deltaMs),
            }
          : group,
      )
    }
    return applyTaskEditPreview(groups, taskEditPreview)
  }, [viewDayGroups, stackDragPreview, taskEditPreview])

  /** Calendar omits stack-drag anchor shift — siblings move via DOM transform. */
  const calendarGroups = useMemo(
    () => applyTaskEditPreview(viewDayGroups, taskEditPreview),
    [viewDayGroups, taskEditPreview],
  )

  const executingGroupId = userData.executingGroupId
  const executingGroup = useMemo(
    () =>
      executingGroupId
        ? plan.plan.groups.find((g) => g.id === executingGroupId)
        : undefined,
    [plan.plan.groups, executingGroupId],
  )
  const executingPreviewGroup = useMemo(
    () =>
      executingGroupId
        ? previewGroups.find((g) => g.id === executingGroupId)
        : undefined,
    [previewGroups, executingGroupId],
  )
  const executingCalendarGroups = useMemo(
    () =>
      executingGroupId
        ? calendarGroups.filter((g) => g.id === executingGroupId)
        : [],
    [calendarGroups, executingGroupId],
  )

  // Drop stale execution if the group was deleted remotely / locally.
  useEffect(() => {
    if (executingGroupId && !executingGroup) {
      setExecutingGroupId(null)
      setExecutionModalOpen(false)
    }
  }, [executingGroupId, executingGroup, setExecutingGroupId])

  const handleTaskEditPreview = useCallback((preview: TaskEditPreview | null) => {
    setTaskEditPreview((prev) => {
      if (
        prev === preview ||
        (prev &&
          preview &&
          prev.groupId === preview.groupId &&
          prev.taskId === preview.taskId &&
          prev.title === preview.title &&
          prev.durationMinutes === preview.durationMinutes &&
          prev.empty === preview.empty)
      ) {
        return prev
      }
      return preview
    })
  }, [])

  function handleEditingIdChange(id: string | null) {
    setEditingTaskId(id)
    if (id == null) setTaskEditPreview(null)
  }

  function handleDatesSet(start: Date, end: Date) {
    calendars.setDates(start, end)
    const next = pickViewDate(start, end)
    setViewDate((prev) =>
      prev.getTime() === next.getTime() ? prev : next,
    )
    setStackDragPreview(null)
    setTaskEditPreview(null)
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

  function handleAddBlocks(groupId: string, inputs: Omit<Task, 'id'>[]) {
    plan.addTasks(groupId, inputs)
    clear()
  }

  function handleGotDelayed(groupId: string) {
    const group = plan.plan.groups.find((g) => g.id === groupId)
    if (!group) return
    const previousTasks = group.tasks
    if (!plan.insertGotDelayed(groupId)) return
    show('info', 'Added a delay block.', {
      ...undoNoticeOptions(userData.settings.quickUndoSeconds, () => {
        plan.replaceTasks(groupId, previousTasks)
        clear()
      }),
    })
  }

  function handleUpdateTask(groupId: string, task: Task) {
    const group = plan.plan.groups.find((g) => g.id === groupId)
    const previous = group?.tasks.find((t) => t.id === task.id)
    const previousTasks = group?.tasks
    const delayDurationChanged =
      Boolean(previous) &&
      isTaskDelay(previous!) &&
      previous!.durationMinutes !== task.durationMinutes

    plan.updateTask(groupId, task)

    if (delayDurationChanged && previousTasks) {
      show('info', 'Delay updated.', {
        ...undoNoticeOptions(userData.settings.quickUndoSeconds, () => {
          plan.replaceTasks(groupId, previousTasks)
          clear()
        }),
      })
    }
  }

  function handleBeginExecution(groupId: string) {
    const group = plan.plan.groups.find((g) => g.id === groupId)
    if (group && !isGroupEnabled(group)) {
      plan.setGroupEnabled(groupId, true)
    }
    if (executingGroupId === groupId) {
      setExecutionModalOpen(true)
      clear()
      return
    }
    plan.beginExecution(groupId)
    setExecutingGroupId(groupId)
    setExecutionModalOpen(true)
    clear()
  }

  function handleEndExecution() {
    if (executingGroupId) {
      plan.clearIntendedEndAt(executingGroupId)
    }
    setExecutingGroupId(null)
    setExecutionModalOpen(false)
    clear()
  }

  const handleEndExecutionRef = useRef(handleEndExecution)
  handleEndExecutionRef.current = handleEndExecution

  useEffect(() => {
    if (!executingGroup) return

    const afterMs = executionAutoEndAfterMs(userData.settings)
    const endIfStale = () => {
      if (shouldAutoEndExecution(executingGroup, new Date(), afterMs))
        handleEndExecutionRef.current()
    }

    endIfStale()
    const autoEndAt = executionAutoEndAt(executingGroup, afterMs)
    if (autoEndAt == null) return
    const remaining = autoEndAt - Date.now()
    if (remaining <= 0) return

    const id = window.setTimeout(endIfStale, remaining)
    const onResume = () => endIfStale()
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('focus', onResume)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('focus', onResume)
    }
  }, [executingGroup, userData.settings])

  function handleRemoveTask(groupId: string, taskId: string) {
    const group = plan.plan.groups.find((g) => g.id === groupId)
    const index = group?.tasks.findIndex((t) => t.id === taskId) ?? -1
    const task = index >= 0 ? group!.tasks[index] : undefined
    if (!task) return

    plan.removeTask(groupId, taskId)
    if (editingTaskId === taskId) handleEditingIdChange(null)

    show('info', `"${task.title}" deleted`, {
      ...undoNoticeOptions(userData.settings.quickUndoSeconds, () => {
        plan.insertTaskAt(groupId, task, index)
        clear()
      }),
    })
  }

  function handleDeleteGroup(groupId: string) {
    if (plan.plan.groups.length <= 1) {
      show('info', 'Keep at least one plan.')
      return
    }
    if (!window.confirm('Delete this plan?')) return
    const index = plan.plan.groups.findIndex((g) => g.id === groupId)
    const group = index >= 0 ? plan.plan.groups[index] : undefined
    if (!group || index < 0) return

    if (executingGroupId === groupId) {
      setExecutingGroupId(null)
      setExecutionModalOpen(false)
    }
    plan.removeGroup(groupId)
    handleEditingIdChange(null)

    const label = group.name?.trim() || 'Untitled plan'
    show('info', `“${label}” deleted`, {
      ...undoNoticeOptions(userData.settings.majorUndoSeconds, () => {
        plan.insertGroupAt(group, index)
        clear()
      }),
    })
  }

  function handleAddGroup() {
    plan.addGroup()
    clear()
  }

  function handleDuplicateGroup(groupId: string) {
    plan.duplicateGroup(groupId)
    handleEditingIdChange(null)
    clear()
  }

  function handleArchiveGroup(groupId: string) {
    if (plan.plan.groups.length <= 1) {
      show('info', 'Keep at least one plan.')
      return
    }
    if (executingGroupId === groupId) {
      show('info', 'End run first.')
      return
    }
    const index = plan.plan.groups.findIndex((g) => g.id === groupId)
    const group = index >= 0 ? plan.plan.groups[index] : undefined
    if (!group) return

    const snapshot = archivedPlanFromGroup(group)
    const nextArchive = addArchivedPlan(userData.planArchive, snapshot)
    userData.replacePlanArchive(nextArchive)
    plan.removeGroup(groupId)
    handleEditingIdChange(null)

    const label = group.name?.trim() || 'Untitled plan'
    show('info', `"${label}" archived`, {
      ...undoNoticeOptions(userData.settings.quickUndoSeconds, () => {
        plan.insertGroupAt(group, index)
        userData.replacePlanArchive(
          removeArchivedPlan(nextArchive, snapshot.id).archive,
        )
        clear()
      }),
    })
  }

  function handleAddArchivedToHome(archived: ArchivedPlan) {
    const id = plan.addGroupFromArchived(archived)
    handleEditingIdChange(null)
    clear()
    return id
  }

  function handleMoveGroup(groupId: string, direction: 'up' | 'down') {
    plan.moveGroup(groupId, direction)
    clear()
  }

  function handleCalendarAnchorCommit(groupId: string, next: StackAnchor) {
    setStackDragPreview(null)
    const group = plan.plan.groups.find((g) => g.id === groupId)
    if (!group) return

    const previousAnchor = { ...group.anchor }
    if (
      previousAnchor.kind === next.kind &&
      previousAnchor.at === next.at
    ) {
      return
    }

    plan.setAnchor(groupId, next)
    show('info', 'Blocks moved.', {
      ...undoNoticeOptions(userData.settings.quickUndoSeconds, () => {
        plan.setAnchor(groupId, previousAnchor)
        clear()
      }),
    })
  }

  function handleSaveCheckpoint(groupId: string) {
    const group = plan.plan.groups.find((g) => g.id === groupId)
    if (!group) return
    if (
      group.checkpoint &&
      !window.confirm(
        'Overwrite your saved default blocks with the current list?',
      )
    ) {
      return
    }
    const previousCheckpoint = group.checkpoint
    plan.saveCheckpoint(groupId)

    show('info', 'Saved as default blocks.', {
      ...undoNoticeOptions(userData.settings.majorUndoSeconds, () => {
        plan.setCheckpoint(groupId, previousCheckpoint)
        clear()
      }),
    })
  }

  function handleRevertToCheckpoint(groupId: string) {
    const group = plan.plan.groups.find((g) => g.id === groupId)
    const previousTasks = group?.tasks
    const previousAnchor = group?.anchor
    if (!previousTasks || !previousAnchor) return

    plan.revertToCheckpoint(groupId)
    handleEditingIdChange(null)

    show('info', 'Reverted to default blocks.', {
      ...undoNoticeOptions(userData.settings.majorUndoSeconds, () => {
        plan.replaceTasks(groupId, previousTasks)
        plan.setAnchor(groupId, previousAnchor)
        clear()
      }),
    })
  }

  /** Returns true when the commit modal should close (full success). */
  async function handleCommit(
    groupId: string,
    calendarIds: string[],
    guestsByCalendar: Record<string, CalendarGuest[]> = {},
  ): Promise<boolean> {
    const group = plan.plan.groups.find((g) => g.id === groupId)
    if (!group) return false
    const anchor = anchorOnDay(group.anchor, viewDate)
    const dayKey = localDateKey(anchor.at)
    const isUpdate = hasPushedGroupOnDay(userData.pushedEvents, groupId, dayKey)
    if (calendarIds.length === 0 && !isUpdate) {
      show('info', 'Choose at least one calendar.')
      return false
    }
    if (group.tasks.length === 0 && !isUpdate) {
      show('info', 'Add at least one block before adding to a calendar.')
      return false
    }

    setCommitBusy(true)
    setCommitProgress({ current: 0, total: 1, label: 'Starting…' })
    session.setError(null)
    clear()
    try {
      await ensureWriteScope()
      // Persist the viewed day so the plan matches what we sync.
      if (group.anchor.at !== anchor.at) {
        plan.setAnchor(groupId, anchor)
      }
      const {
        updated,
        created,
        removed,
        failures,
        pushedEvents,
        pushSnapshots,
        removedCalendarIds,
        successfulCalendarIds,
      } = await syncGroupToCalendars(
        calendarIds,
        groupId,
        group.tasks,
        anchor,
        userData.pushedEvents,
        userData.firebaseUser?.uid ?? null,
        setCommitProgress,
        guestsByCalendar,
      )
      if (successfulCalendarIds.length > 0) {
        const persisted: Record<string, CalendarGuest[]> = {}
        for (const calendarId of successfulCalendarIds) {
          persisted[calendarId] = guestsByCalendar[calendarId] ?? []
        }
        plan.setCalendarGuests(groupId, persisted)
      }
      userData.applyCalendarSync(
        pushedEvents,
        pushSnapshots,
        removedCalendarIds.map((calendarId) => ({
          calendarId,
          groupId,
          dayKey,
        })),
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
      if (updated) parts.push(parts.length ? `updated ${updated}` : `Updated ${updated}`)
      if (created) parts.push(parts.length ? `added ${created}` : `Added ${created}`)
      if (removed) parts.push(parts.length ? `removed ${removed}` : `Removed ${removed}`)
      let syncMessage = 'Calendar already up to date.'
      if (parts.length > 0) {
        const joined =
          parts.length === 1
            ? parts[0]!
            : parts.length === 2
              ? `${parts[0]} and ${parts[1]}`
              : `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`
        syncMessage = `${joined} events on Google Calendar`
        if (calendarIds.length > 1) {
          syncMessage += ` across ${calendarIds.length} Google Calendars`
        }
        syncMessage += '.'
      }
      show('success', syncMessage)
      return true
    } catch (err) {
      show('error', `Couldn't sync calendar: ${formatError(err)}`)
      return false
    } finally {
      setCommitBusy(false)
      setCommitProgress(null)
    }
  }

  async function handleDeleteFromCalendar(groupId: string) {
    const group = plan.plan.groups.find((g) => g.id === groupId)
    if (!group) return
    const anchor = anchorOnDay(group.anchor, viewDate)
    const dayKey = localDateKey(anchor.at)
    if (!hasPushedGroupOnDay(userData.pushedEvents, groupId, dayKey)) return
    const calendarNames = calendarNamesForPushedGroupDay(
      userData.pushedEvents,
      calendars.calendars,
      groupId,
      dayKey,
    )
    const calendarLabel =
      calendarNames.length === 1
        ? `“${calendarNames[0]}”`
        : calendarNames.map((name) => `“${name}”`).join(' and ')
    if (
      !window.confirm(
        `Remove this plan’s blocks from ${calendarLabel} for this day?`,
      )
    ) {
      return
    }

    setCommitBusy(true)
    session.setError(null)
    clear()
    const calendarWord =
      calendarNames.length > 1 ? 'calendars' : 'calendar'
    try {
      await ensureWriteScope()
      const { removed, failures, pushedEvents } = await deleteGroupFromCalendar(
        groupId,
        dayKey,
        userData.pushedEvents,
        (progress) => {
          const step =
            progress.current === 0
              ? 'Starting…'
              : `Removing ${progress.current} of ${progress.total}`
          show('info', `Removing events from ${calendarWord}: ${step}`, {
            persist: true,
            progress: {
              current: progress.current,
              total: Math.max(progress.total, 1),
            },
          })
        },
      )
      userData.applyCalendarDelete(pushedEvents, groupId, dayKey)
      await calendars.refreshEvents()

      if (failures.length > 0) {
        const detail = failures
          .map((f) => `${f.action}: ${f.message}`)
          .join(' · ')
        const prefix =
          removed > 0
            ? `Removed ${removed}, but couldn't remove all events: `
            : "Couldn't remove from calendar: "
        show('error', `${prefix}${detail}`)
        return
      }

      show(
        'success',
        removed > 0
          ? `Removed ${removed} from Google Calendar.`
          : 'Nothing left on Google Calendar for this day.',
      )
    } catch (err) {
      show('error', `Couldn't remove from calendar: ${formatError(err)}`)
    } finally {
      setCommitBusy(false)
    }
  }

  const missingClientId =
    import.meta.env.DEV &&
    (!import.meta.env.VITE_GOOGLE_CLIENT_ID ||
      String(import.meta.env.VITE_GOOGLE_CLIENT_ID).includes('your-client-id'))
  const missingFirebase = import.meta.env.DEV && !isFirebaseConfigured()
  const buildTimeLabel = useMemo(() => {
    const d = new Date(__BUILD_TIME__)
    if (Number.isNaN(d.getTime())) return `Build time: ${__BUILD_TIME__}`
    const date = `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`
    const time = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(d)
    return `Build time: ${date} at ${time}`
  }, [])

  // After OAuth → app-body mounts; give flex layout a moment then the calendar
  // measures itself via ResizeObserver (pixel height, not percentage).
  useLayoutEffect(() => {
    if (!session.ready || !session.signedIn || userData.loading) return

    function nudgeLayout() {
      window.dispatchEvent(new Event('resize'))
    }

    nudgeLayout()
    requestAnimationFrame(nudgeLayout)
    const timers = [50, 150, 400].map((ms) => window.setTimeout(nudgeLayout, ms))

    return () => {
      for (const id of timers) window.clearTimeout(id)
    }
  }, [session.ready, session.signedIn, userData.loading])

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

      {executingGroup && !executionModalOpen && (
        <div className="banner banner-execution" role="status">
          <button
            type="button"
            className="execution-banner-open"
            onClick={() => handleBeginExecution(executingGroup.id)}
          >
            Running “{executingGroup.name?.trim() || 'Untitled plan'}”
          </button>
          <button
            type="button"
            className="execution-chrome-action"
            onClick={handleEndExecution}
          >
            End run
          </button>
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
            <h2>Time blindness is real!</h2>
            <p>
              {session.diagnostics.canRecoverWithoutOauth
                ? 'Silent sign-in failed after reopen (often a cold auth backend). Try Recover session below — you usually do not need the full Google consent popup.'
                : 'Time Block lets you draft plans that end when you need to leave, and compensate for delays as you go so you stay on time. Your plan syncs to your Google account.'}
            </p>
            {session.diagnostics.canRecoverWithoutOauth ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  session.testRefreshBusy ||
                  busy ||
                  missingClientId ||
                  missingFirebase
                }
                onClick={() => void session.testRefresh()}
              >
                {session.testRefreshBusy
                  ? 'Recovering…'
                  : 'Recover session'}
              </button>
            ) : (
              <AuthButton
                signedIn={false}
                busy={busy || missingClientId || missingFirebase}
                onSignIn={() => void handleSignIn()}
                onSignOut={handleSignOut}
              />
            )}
            {session.diagnostics.canRecoverWithoutOauth && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy || session.testRefreshBusy}
                onClick={() => void handleSignIn()}
              >
                Sign in with Google instead
              </button>
            )}
          </div>
          <div className="app-gate-footer">
            <p className="app-gate-build">{buildTimeLabel}</p>
            <AuthSessionDiagnostics
              diagnostics={session.diagnostics}
              signedIn={session.signedIn}
              testBusy={session.testRefreshBusy}
              onTestRefresh={() => void session.testRefresh()}
              compact
            />
          </div>
        </div>
      ) : (
        <div className="app-body" ref={appBodyRef} style={bodyStyle}>
          <TaskSidebar
            groups={previewGroups}
            canDeleteGroup={plan.plan.groups.length > 1}
            writableCalendars={listedWritableCalendars}
            onAdd={handleAddTask}
            onAddBlocks={handleAddBlocks}
            onUpdate={handleUpdateTask}
            onRemove={handleRemoveTask}
            onReorder={plan.reorderTasks}
            onAnchorChange={(groupId, next) => {
              setStackDragPreview(null)
              plan.setAnchor(groupId, next)
            }}
            onDeleteGroup={handleDeleteGroup}
            onDuplicateGroup={handleDuplicateGroup}
            onArchiveGroup={handleArchiveGroup}
            onMoveGroup={handleMoveGroup}
            onSaveCheckpoint={handleSaveCheckpoint}
            onRevertToCheckpoint={handleRevertToCheckpoint}
            onGotDelayed={handleGotDelayed}
            onExecutePlan={handleBeginExecution}
            executingGroupId={executingGroupId}
            onAddGroup={handleAddGroup}
            onSetGroupEnabled={plan.setGroupEnabled}
            onSetGroupName={plan.setGroupName}
            onSetGroupColor={plan.setGroupColor}
            onCommit={handleCommit}
            onDeleteFromCalendar={handleDeleteFromCalendar}
            onTaskEditPreview={handleTaskEditPreview}
            editingId={editingTaskId}
            onEditingIdChange={handleEditingIdChange}
            busy={busy}
            commitProgress={commitProgress}
            signedIn={session.signedIn}
            onSignIn={() => void handleSignIn()}
            onSignOut={handleSignOut}
            authDiagnostics={session.diagnostics}
            authSignedIn={session.signedIn}
            authTestRefreshBusy={session.testRefreshBusy}
            onAuthTestRefresh={() => void session.testRefresh()}
            targetCalendarId={userData.targetCalendarId}
            onTargetCalendarChange={userData.setTargetCalendarId}
            pushedEvents={userData.pushedEvents}
            pushSnapshots={userData.pushSnapshots}
            blockLibrary={userData.blockLibrary}
            onReplaceBlockLibrary={userData.replaceBlockLibrary}
            planArchive={userData.planArchive}
            onReplacePlanArchive={userData.replacePlanArchive}
            onAddArchivedToHome={handleAddArchivedToHome}
            onShowNotice={(text, options) => show('info', text, options)}
            onClearNotice={clear}
            savedCalendarUsers={userData.savedCalendarUsers}
            onReplaceSavedCalendarUsers={userData.replaceSavedCalendarUsers}
            settings={userData.settings}
            onReplaceSettings={userData.replaceSettings}
            allCalendars={calendars.calendars}
            plan={plan.plan}
            onReplacePlan={plan.replacePlan}
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
              calendars={listedCalendars}
              visibleCalendarIds={calendars.visibleIds}
              onToggleCalendar={calendars.toggleCalendar}
              groups={calendarGroups}
              onDatesSet={handleDatesSet}
              onAnchorCommit={handleCalendarAnchorCommit}
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

      {executionModalOpen &&
        executingPreviewGroup &&
        executingGroup && (
          <ExecutionModal
            group={executingGroup}
            groupsForSidebar={[executingPreviewGroup]}
            calendarGroups={executingCalendarGroups}
            googleEvents={calendars.googleEvents}
            calendars={listedCalendars}
            visibleCalendarIds={calendars.visibleIds}
            onToggleCalendar={calendars.toggleCalendar}
            writableCalendars={listedWritableCalendars}
            onAdd={handleAddTask}
            onAddBlocks={handleAddBlocks}
            onUpdate={handleUpdateTask}
            onRemove={handleRemoveTask}
            onReorder={plan.reorderTasks}
            onAnchorChange={(groupId, next) => {
              setStackDragPreview(null)
              plan.setAnchor(groupId, next)
            }}
            onGotDelayed={handleGotDelayed}
            onIntendedEndChange={(groupId, intendedEndAt) => {
              plan.setIntendedEndAt(groupId, intendedEndAt)
            }}
            onSaveCheckpoint={handleSaveCheckpoint}
            onRevertToCheckpoint={handleRevertToCheckpoint}
            onSetGroupName={plan.setGroupName}
            onSetGroupColor={plan.setGroupColor}
            onSetGroupEnabled={plan.setGroupEnabled}
            onCommit={handleCommit}
            onDeleteFromCalendar={handleDeleteFromCalendar}
            onTaskEditPreview={handleTaskEditPreview}
            editingId={editingTaskId}
            onEditingIdChange={handleEditingIdChange}
            onDatesSet={handleDatesSet}
            onTaskClick={setEditingTaskId}
            busy={busy}
            commitProgress={commitProgress}
            targetCalendarId={userData.targetCalendarId}
            onTargetCalendarChange={userData.setTargetCalendarId}
            pushedEvents={userData.pushedEvents}
            pushSnapshots={userData.pushSnapshots}
            blockLibrary={userData.blockLibrary}
            onReplaceBlockLibrary={userData.replaceBlockLibrary}
            planArchive={userData.planArchive}
            onReplacePlanArchive={userData.replacePlanArchive}
            onAddArchivedToHome={handleAddArchivedToHome}
            onShowNotice={(text, options) => show('info', text, options)}
            onClearNotice={clear}
            savedCalendarUsers={userData.savedCalendarUsers}
            onReplaceSavedCalendarUsers={userData.replaceSavedCalendarUsers}
            onClose={() => setExecutionModalOpen(false)}
            onEndExecution={handleEndExecution}
            splitStyle={splitStyle}
            onSplitChange={setSplitPercent}
          />
        )}

      {notice && <NoticeToast notice={notice} />}
    </div>
  )
}
