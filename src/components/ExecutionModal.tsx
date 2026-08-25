import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { GoogleCalendar, CalendarEvent, SyncProgress } from '../lib/calendarApi'
import type {
  BlockGroup,
  BlockLibrary,
  CalendarGuest,
  StackAnchor,
  Task,
} from '../lib/tasks'
import { stackOccupiedLocalDays, startOfLocalDay } from '../lib/tasks'
import type { ArchivedPlan, PlanArchive } from '../lib/planArchive'
import type { NoticeOptions } from '../lib/notice'
import type { PushedEvent, PushSnapshot } from '../lib/pushedEvents'
import type { SavedCalendarUser } from '../lib/savedCalendarUsers'
import { CalendarView } from './CalendarView'
import { MobileSplitHandle } from './MobileSplitHandle'
import { TaskSidebar } from './TaskSidebar'

type ExecutionModalProps = {
  group: BlockGroup
  groupsForSidebar: BlockGroup[]
  calendarGroups: BlockGroup[]
  googleEvents: CalendarEvent[]
  calendars: GoogleCalendar[]
  visibleCalendarIds: Set<string>
  onToggleCalendar: (calendarId: string) => void
  writableCalendars: GoogleCalendar[]
  onAdd: (groupId: string, task: Omit<Task, 'id'>) => void
  onAddBlocks: (groupId: string, tasks: Omit<Task, 'id'>[]) => void
  onUpdate: (groupId: string, task: Task) => void
  onRemove: (groupId: string, id: string) => void
  onReorder: (groupId: string, fromIndex: number, toIndex: number) => void
  onAnchorChange: (groupId: string, anchor: StackAnchor) => void
  onGotDelayed: (groupId: string) => void
  onIntendedEndChange: (groupId: string, intendedEndAt: string) => void
  onSaveCheckpoint: (groupId: string) => void
  onRevertToCheckpoint: (groupId: string) => void
  onSetGroupName: (groupId: string, name: string) => void
  onSetGroupColor: (groupId: string, color: string | undefined) => void
  onSetGroupEnabled: (groupId: string, enabled: boolean) => void
  onCommit: (
    groupId: string,
    calendarIds: string[],
    guestsByCalendar: Record<string, CalendarGuest[]>,
  ) => Promise<boolean>
  onDeleteFromCalendar: (groupId: string) => Promise<void>
  onTaskEditPreview: (preview: {
    groupId: string
    taskId: string
    title: string
    durationMinutes: number
    empty?: boolean
  } | null) => void
  editingId: string | null
  onEditingIdChange: (id: string | null) => void
  focusedTaskId?: string | null
  onDatesSet: (start: Date, end: Date) => void
  onTaskClick: (taskId: string) => void
  busy?: boolean
  commitProgress?: SyncProgress | null
  targetCalendarId: string
  onTargetCalendarChange: (id: string) => void
  pushedEvents: PushedEvent[]
  pushSnapshots: PushSnapshot[]
  blockLibrary: BlockLibrary
  onReplaceBlockLibrary: (library: BlockLibrary) => void
  planArchive: PlanArchive
  planArchiveLoading?: boolean
  onEnsurePlanArchiveLoaded?: () => Promise<void>
  onReplacePlanArchive: (archive: PlanArchive) => void
  onAddArchivedToHome: (plan: ArchivedPlan) => string
  onShowNotice?: (text: string, options?: NoticeOptions) => void
  onClearNotice?: () => void
  savedCalendarUsers: SavedCalendarUser[]
  onReplaceSavedCalendarUsers: (users: SavedCalendarUser[]) => void
  onClose: () => void
  onEndExecution: () => void
  /** Same mobile split CSS vars / setter as the main app body. */
  splitStyle?: CSSProperties
  onSplitChange?: (percent: number) => void
}

/**
 * Full-screen execution UI for a single plan: editable stack (Starts
 * locked) + calendar without stack-drag.
 */
export function ExecutionModal({
  group,
  groupsForSidebar,
  calendarGroups,
  googleEvents,
  calendars,
  visibleCalendarIds,
  onToggleCalendar,
  writableCalendars,
  onAdd,
  onAddBlocks,
  onUpdate,
  onRemove,
  onReorder,
  onAnchorChange,
  onGotDelayed,
  onIntendedEndChange,
  onSaveCheckpoint,
  onRevertToCheckpoint,
  onSetGroupName,
  onSetGroupColor,
  onSetGroupEnabled,
  onCommit,
  onDeleteFromCalendar,
  onTaskEditPreview,
  editingId,
  onEditingIdChange,
  focusedTaskId = null,
  onDatesSet,
  onTaskClick,
  busy,
  commitProgress = null,
  targetCalendarId,
  onTargetCalendarChange,
  pushedEvents,
  pushSnapshots,
  blockLibrary,
  onReplaceBlockLibrary,
  planArchive,
  planArchiveLoading,
  onEnsurePlanArchiveLoaded,
  onReplacePlanArchive,
  onAddArchivedToHome,
  onShowNotice,
  onClearNotice,
  savedCalendarUsers,
  onReplaceSavedCalendarUsers,
  onClose,
  onEndExecution,
  splitStyle,
  onSplitChange,
}: ExecutionModalProps) {
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const label = group.name?.trim() || 'Untitled plan'
  const titleText = `Running “${label}”`
  const navDayBounds = useMemo(
    () => stackOccupiedLocalDays(group),
    [group],
  )

  return (
    <div className="execution-modal" role="dialog" aria-modal="true" aria-label={titleText}>
      <div className="execution-modal-toolbar">
        <div className="execution-modal-toolbar-rail execution-modal-toolbar-rail-start">
          <button
            type="button"
            className="execution-chrome-action"
            onClick={onClose}
          >
            ← Plan mode
          </button>
        </div>
        <div className="execution-modal-toolbar-title">{titleText}</div>
        <div className="execution-modal-toolbar-rail execution-modal-toolbar-rail-end">
          <button
            type="button"
            className="execution-chrome-action"
            onClick={onEndExecution}
          >
            End run
          </button>
        </div>
      </div>
      <div className="execution-modal-body" ref={bodyRef} style={splitStyle}>
        <TaskSidebar
          mode="execution"
          groups={groupsForSidebar}
          canDeleteGroup={false}
          writableCalendars={writableCalendars}
          onAdd={onAdd}
          onAddBlocks={onAddBlocks}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onReorder={onReorder}
          onAnchorChange={onAnchorChange}
          onDeleteGroup={() => {}}
          onDuplicateGroup={() => {}}
          onArchiveGroup={() => {}}
          onMoveGroup={() => {}}
          onSaveCheckpoint={onSaveCheckpoint}
          onRevertToCheckpoint={onRevertToCheckpoint}
          onGotDelayed={onGotDelayed}
          onIntendedEndChange={onIntendedEndChange}
          onAddGroup={() => {}}
          onSetGroupEnabled={onSetGroupEnabled}
          onSetGroupName={onSetGroupName}
          onSetGroupColor={onSetGroupColor}
          onCommit={onCommit}
          onDeleteFromCalendar={onDeleteFromCalendar}
          onTaskEditPreview={onTaskEditPreview}
          editingId={editingId}
          onEditingIdChange={onEditingIdChange}
          focusedTaskId={focusedTaskId}
          busy={busy}
          commitProgress={commitProgress}
          targetCalendarId={targetCalendarId}
          onTargetCalendarChange={onTargetCalendarChange}
          pushedEvents={pushedEvents}
          pushSnapshots={pushSnapshots}
          blockLibrary={blockLibrary}
          onReplaceBlockLibrary={onReplaceBlockLibrary}
          planArchive={planArchive}
          planArchiveLoading={planArchiveLoading}
          onEnsurePlanArchiveLoaded={onEnsurePlanArchiveLoaded}
          onReplacePlanArchive={onReplacePlanArchive}
          onAddArchivedToHome={onAddArchivedToHome}
          onShowNotice={onShowNotice}
          onClearNotice={onClearNotice}
          savedCalendarUsers={savedCalendarUsers}
          onReplaceSavedCalendarUsers={onReplaceSavedCalendarUsers}
        />
        {onSplitChange && (
          <MobileSplitHandle bodyRef={bodyRef} onSplitChange={onSplitChange} />
        )}
        <main className="main-panel">
          <CalendarView
            googleEvents={googleEvents}
            calendars={calendars}
            visibleCalendarIds={visibleCalendarIds}
            onToggleCalendar={onToggleCalendar}
            groups={calendarGroups}
            onDatesSet={onDatesSet}
            onAnchorCommit={() => {}}
            onTaskClick={onTaskClick}
            busy={busy}
            stackDragEnabled={false}
            navDayBounds={navDayBounds}
            initialDate={startOfLocalDay(new Date(group.anchor.at))}
            scrollTasksIntoViewOnMount
          />
        </main>
      </div>
    </div>
  )
}
