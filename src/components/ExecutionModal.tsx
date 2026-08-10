import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { GoogleCalendar, CalendarEvent } from '../lib/calendarApi'
import type {
  BlockGroup,
  BlockLibrary,
  StackAnchor,
  Task,
} from '../lib/tasks'
import { stackOccupiedLocalDays } from '../lib/tasks'
import type { NoticeOptions } from '../lib/notice'
import type { PushedEvent, PushSnapshot } from '../lib/pushedEvents'
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
  onCommit: (groupId: string, calendarIds: string[]) => Promise<boolean>
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
  onDatesSet: (start: Date, end: Date) => void
  onTaskClick: (taskId: string) => void
  busy?: boolean
  targetCalendarId: string
  onTargetCalendarChange: (id: string) => void
  pushedEvents: PushedEvent[]
  pushSnapshots: PushSnapshot[]
  blockLibrary: BlockLibrary
  onReplaceBlockLibrary: (library: BlockLibrary) => void
  onShowNotice?: (text: string, options?: NoticeOptions) => void
  onClearNotice?: () => void
  onClose: () => void
  onEndExecution: () => void
  /** Same mobile split CSS vars / setter as the main app body. */
  splitStyle?: CSSProperties
  onSplitChange?: (percent: number) => void
}

/**
 * Full-screen execution UI for a single block group: editable stack (Starts
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
  onDatesSet,
  onTaskClick,
  busy,
  targetCalendarId,
  onTargetCalendarChange,
  pushedEvents,
  pushSnapshots,
  blockLibrary,
  onReplaceBlockLibrary,
  onShowNotice,
  onClearNotice,
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
  const navDayBounds = useMemo(
    () => stackOccupiedLocalDays(group),
    [group],
  )

  return (
    <div className="execution-modal" role="dialog" aria-modal="true" aria-label={`Executing ${label}`}>
      <div className="execution-modal-toolbar">
        <div className="execution-modal-toolbar-title">
          <strong>{label}</strong>
        </div>
        <div className="execution-modal-toolbar-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onEndExecution}
          >
            End execution
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm execution-modal-close"
            aria-label="Close execution view"
            onClick={onClose}
          >
            ×
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
          busy={busy}
          targetCalendarId={targetCalendarId}
          onTargetCalendarChange={onTargetCalendarChange}
          pushedEvents={pushedEvents}
          pushSnapshots={pushSnapshots}
          blockLibrary={blockLibrary}
          onReplaceBlockLibrary={onReplaceBlockLibrary}
          onShowNotice={onShowNotice}
          onClearNotice={onClearNotice}
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
            scrollTasksIntoViewOnMount
          />
        </main>
      </div>
    </div>
  )
}
