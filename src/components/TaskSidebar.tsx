import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { GoogleCalendar, SyncProgress } from '../lib/calendarApi'
import type {
  BlockGroup,
  BlockLibrary,
  CalendarGuest,
  Plan,
  StackAnchor,
  Task,
} from '../lib/tasks'
import type { SavedCalendarUser } from '../lib/savedCalendarUsers'
import type { UserSettings } from '../lib/userSettings'
import { defaultUserSettings } from '../lib/userSettings'
import {
  blockLibraryKey,
  DEFAULT_GROUP_COLOR,
  createSavedBlock,
  formatDurationMinutes,
  fromLocalTimeValue,
  getStackEndStatus,
  groupSidebarAccentColor,
  isGroupEnabled,
  isGroupExecutableNow,
  isTaskDelay,
  isTaskDisabled,
  isTaskEmpty,
  isTaskInBlockLibrary,
  localDateKey,
  groupMatchesCheckpoint,
  optionalNote,
  resolveSavedBlocksFromKeys,
  resolveStack,
  stackDayBoundaryOffsets,
  stackDurationMinutes,
  stepLocalTime,
  toggleAnchorPreservingStack,
  toLocalTimeValue,
  touchBlockLibrary,
} from '../lib/tasks'
import {
  calendarCommitLabel,
  hasPushedGroupOnDay,
  hasPushedTaskOnDay,
  isTaskPushUnchanged,
  pushedCalendarIdsForGroupDay,
  type PushedEvent,
  type PushSnapshot,
} from '../lib/pushedEvents'
import { useFixedMenu } from '../hooks/useFixedMenu'
import { FixedMenuPortal } from './FixedMenuPortal'
import { SettingsMenu } from './SettingsMenu'
import { CommitCalendarInvite } from './CommitCalendarInvite'
import { BlockLibraryModal } from './BlockLibraryModal'
import { TaskFieldsForm } from './TaskFieldsForm'
import {
  BlockIcon,
  DelayedIcon,
  DisableBlockIcon,
  FinishedCheckIcon,
  LibraryIcon,
  NoteIcon,
  PendingIcon,
} from './icons'
import type { NoticeOptions } from '../lib/notice'
import type { SessionDiagnostics } from '../lib/google'
import type { ArchivedPlan, PlanArchive } from '../lib/planArchive'
import {
  attachReorderDragListeners,
  consumeReorderClickSuppression,
} from '../lib/reorderDrag'
import { ArchivedPlansModal } from './ArchivedPlansModal'

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

const NEW_EDIT_ID = '__new__'
const ANCHOR_SCRUB_PX = 25
const ANCHOR_SCRUB_ACTIVATE_PX = 8
const TASK_FOCUS_SCROLL_MARGIN = 40

function scrollTaskIntoViewWithMargin(card: HTMLElement) {
  let scroller = card.parentElement
  while (scroller) {
    const style = window.getComputedStyle(scroller)
    if (
      scroller.scrollHeight > scroller.clientHeight &&
      /(auto|scroll)/.test(style.overflowY)
    ) {
      const cardRect = card.getBoundingClientRect()
      const scrollRect = scroller.getBoundingClientRect()
      const top = scrollRect.top + TASK_FOCUS_SCROLL_MARGIN
      const bottom = scrollRect.bottom - TASK_FOCUS_SCROLL_MARGIN
      const delta =
        cardRect.top < top
          ? cardRect.top - top
          : cardRect.bottom > bottom
            ? cardRect.bottom - bottom
            : 0
      if (delta !== 0) {
        scroller.scrollTo({
          top: scroller.scrollTop + delta,
          behavior: 'smooth',
        })
      }
      return
    }
    scroller = scroller.parentElement
  }
}

type AnchorField = 'hour' | 'minute'
type ModalKind = 'commit' | 'name'

function readSelectionStart(input: HTMLInputElement): number | null {
  try {
    return input.selectionStart
  } catch {
    return null
  }
}

/** Value shape: HH:mm */
function anchorFieldFromSelection(start: number | null): AnchorField {
  if (start == null) return 'minute'
  if (start <= 2) return 'hour'
  return 'minute'
}

type TaskSidebarProps = {
  groups: BlockGroup[]
  canDeleteGroup: boolean
  writableCalendars: GoogleCalendar[]
  onAdd: (groupId: string, task: Omit<Task, 'id'>, index?: number) => void
  onAddBlocks: (
    groupId: string,
    tasks: Omit<Task, 'id'>[],
    index?: number,
  ) => void
  onUpdate: (groupId: string, task: Task) => void
  onRemove: (groupId: string, id: string) => void
  onReorder: (groupId: string, fromIndex: number, toIndex: number) => void
  onAnchorChange: (groupId: string, anchor: StackAnchor) => void
  onDeleteGroup: (groupId: string) => void
  onDuplicateGroup: (groupId: string) => void
  onArchiveGroup: (groupId: string) => void
  onMoveGroup: (groupId: string, direction: 'up' | 'down') => void
  onSaveCheckpoint: (groupId: string) => void
  onRevertToCheckpoint: (groupId: string) => void
  onGotDelayed: (groupId: string) => void
  onExecutePlan?: (groupId: string) => void
  onIntendedEndChange?: (groupId: string, intendedEndAt: string) => void
  /** When set, another group is already running (hides Start on others). */
  executingGroupId?: string | null
  /** Planning sidebar vs single-group execution panel. */
  mode?: 'planning' | 'execution'
  onAddGroup: () => void
  onSetGroupEnabled: (groupId: string, enabled: boolean) => void
  onSetGroupName: (groupId: string, name: string) => void
  onSetGroupColor: (groupId: string, color: string | undefined) => void
  onCommit: (
    groupId: string,
    calendarIds: string[],
    guestsByCalendar: Record<string, CalendarGuest[]>,
  ) => Promise<boolean>
  onDeleteFromCalendar: (groupId: string) => Promise<void>
  onTaskEditPreview: (preview: {
    groupId: string
    taskId: string
    durationMinutes: number
    title: string
    empty?: boolean
  } | null) => void
  editingId: string | null
  onEditingIdChange: (id: string | null) => void
  focusedTaskId?: string | null
  busy?: boolean
  commitProgress?: SyncProgress | null
  signedIn?: boolean
  onSignIn?: () => void
  onSignOut?: () => void
  authDiagnostics?: SessionDiagnostics
  authSignedIn?: boolean
  authTestRefreshBusy?: boolean
  onAuthTestRefresh?: () => void
  /** Cross-device data — owned and synced by the caller (see useUserData). */
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
  /** Required in planning mode (Settings). */
  settings?: UserSettings
  onReplaceSettings?: (settings: UserSettings) => void
  allCalendars?: GoogleCalendar[]
  plan?: Plan
  onReplacePlan?: (plan: Plan) => void
}

export function TaskSidebar({
  groups,
  canDeleteGroup,
  writableCalendars,
  onAdd,
  onAddBlocks,
  onUpdate,
  onRemove,
  onReorder,
  onAnchorChange,
  onDeleteGroup,
  onDuplicateGroup,
  onArchiveGroup,
  onMoveGroup,
  onSaveCheckpoint,
  onRevertToCheckpoint,
  onGotDelayed,
  onExecutePlan,
  onIntendedEndChange,
  executingGroupId = null,
  mode = 'planning',
  onAddGroup,
  onSetGroupEnabled,
  onSetGroupName,
  onSetGroupColor,
  onCommit,
  onDeleteFromCalendar,
  onTaskEditPreview,
  editingId,
  onEditingIdChange,
  focusedTaskId = null,
  busy,
  commitProgress = null,
  signedIn,
  onSignIn,
  onSignOut,
  authDiagnostics,
  authSignedIn,
  authTestRefreshBusy,
  onAuthTestRefresh,
  targetCalendarId,
  onTargetCalendarChange,
  pushedEvents,
  pushSnapshots,
  blockLibrary,
  onReplaceBlockLibrary,
  planArchive,
  planArchiveLoading = false,
  onEnsurePlanArchiveLoaded,
  onReplacePlanArchive,
  onAddArchivedToHome,
  onShowNotice,
  onClearNotice,
  savedCalendarUsers,
  onReplaceSavedCalendarUsers,
  settings = defaultUserSettings(),
  onReplaceSettings,
  allCalendars = [],
  plan = { groups: [] },
  onReplacePlan,
}: TaskSidebarProps) {
  const [groupNameInput, setGroupNameInput] = useState('')
  const [modal, setModal] = useState<ModalKind | null>(null)
  const [modalGroupId, setModalGroupId] = useState<string | null>(null)
  const [addingGroupId, setAddingGroupId] = useState<string | null>(null)
  const [archivedPlansOpen, setArchivedPlansOpen] = useState(false)

  function openArchivedPlans() {
    setArchivedPlansOpen(true)
    void onEnsurePlanArchiveLoaded?.()
  }
  const [blockLibraryOpen, setBlockLibraryOpen] = useState(false)
  const [libraryFocusBlockId, setLibraryFocusBlockId] = useState<string | null>(
    null,
  )
  const [addToLibraryTask, setAddToLibraryTask] = useState<Task | null>(null)
  const [addToLibraryCategoryId, setAddToLibraryCategoryId] = useState('')
  const [addToLibraryCategoryName, setAddToLibraryCategoryName] = useState('')
  const [scrollToGroupId, setScrollToGroupId] = useState<string | null>(null)
  const blockGroupsRef = useRef<HTMLDivElement>(null)
  const [selectedCommitIds, setSelectedCommitIds] = useState<string[]>([])
  /** Snapshot of calendar order when the commit modal opens (selected first). */
  const [commitCalendarOrder, setCommitCalendarOrder] = useState<string[]>([])
  const [commitGuestsByCalendar, setCommitGuestsByCalendar] = useState<
    Record<string, CalendarGuest[]>
  >({})
  const [commitLastGuestsByCalendar, setCommitLastGuestsByCalendar] = useState<
    Record<string, CalendarGuest[]>
  >({})

  const defaultCommitCalendarId = useMemo(() => {
    if (
      targetCalendarId &&
      writableCalendars.some((c) => c.id === targetCalendarId)
    ) {
      return targetCalendarId
    }
    return (
      writableCalendars.find((c) => c.primary)?.id ||
      writableCalendars[0]?.id ||
      ''
    )
  }, [targetCalendarId, writableCalendars])

  const modalGroup = groups.find((g) => g.id === modalGroupId) ?? null
  const unnamedGroupLabels = useMemo(() => {
    const labels = new Map<string, string>()
    let n = 0
    for (const g of groups) {
      if (!g.name?.trim()) {
        n += 1
        labels.set(g.id, `Unnamed ${n}`)
      }
    }
    return labels
  }, [groups])

  useEffect(() => {
    if (!editingId || editingId === NEW_EDIT_ID) return
    if (!groups.some((g) => g.tasks.some((t) => t.id === editingId))) {
      onEditingIdChange(null)
    }
  }, [editingId, groups, onEditingIdChange])

  useLayoutEffect(() => {
    if (!scrollToGroupId) return
    const el = blockGroupsRef.current?.querySelector(
      `[data-group-id="${scrollToGroupId}"]`,
    )
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setScrollToGroupId(null)
  }, [scrollToGroupId, groups])

  function handleAddFromArchive(archived: ArchivedPlan) {
    const id = onAddArchivedToHome(archived)
    setScrollToGroupId(id)
  }

  function openModal(kind: ModalKind, groupId: string) {
    setModalGroupId(groupId)
    if (kind === 'name') {
      const group = groups.find((g) => g.id === groupId)
      setGroupNameInput(group?.name ?? '')
    }
    if (kind === 'commit') {
      const group = groups.find((g) => g.id === groupId)
      const dayKey = group ? localDateKey(group.anchor.at) : ''
      const pushedCalIds = pushedCalendarIdsForGroupDay(
        pushedEvents,
        groupId,
        dayKey,
      ).filter((id) => writableCalendars.some((c) => c.id === id))
      const initialSelected =
        pushedCalIds.length > 0
          ? pushedCalIds
          : defaultCommitCalendarId
            ? [defaultCommitCalendarId]
            : []
      setSelectedCommitIds(initialSelected)
      const selected = new Set(initialSelected)
      setCommitCalendarOrder(
        [...writableCalendars]
          .sort((a, b) => {
            const aSelected = selected.has(a.id)
            const bSelected = selected.has(b.id)
            if (aSelected !== bSelected) return aSelected ? -1 : 1
            if (a.primary && !b.primary) return -1
            if (!a.primary && b.primary) return 1
            return a.summary.localeCompare(b.summary)
          })
          .map((calendar) => calendar.id),
      )
      setCommitGuestsByCalendar({ ...(group?.calendarGuests ?? {}) })
      setCommitLastGuestsByCalendar({ ...(group?.calendarGuests ?? {}) })
    }
    setModal(kind)
  }

  function closeModal() {
    setModal(null)
    setModalGroupId(null)
    setCommitCalendarOrder([])
    setCommitGuestsByCalendar({})
    setCommitLastGuestsByCalendar({})
  }

  const modalDayKey = modalGroup ? localDateKey(modalGroup.anchor.at) : ''
  const modalIsUpdate =
    Boolean(modalGroupId) &&
    hasPushedGroupOnDay(pushedEvents, modalGroupId || '', modalDayKey)

  async function handleCommit() {
    if (selectedCommitIds.length === 0 && !modalIsUpdate) return
    if (!modalGroupId) return
    const ok = await onCommit(modalGroupId, selectedCommitIds, commitGuestsByCalendar)
    if (ok) {
      closeModal()
    }
  }

  function handleNameGroup(e: React.FormEvent) {
    e.preventDefault()
    if (!modalGroupId) return
    onSetGroupName(modalGroupId, groupNameInput)
    closeModal()
  }

  const modalPushedCalendarCount = modalGroupId
    ? pushedCalendarIdsForGroupDay(pushedEvents, modalGroupId, modalDayKey)
        .length
    : 0
  const commitCalendars = useMemo(() => {
    const byId = new Map(writableCalendars.map((c) => [c.id, c]))
    const ordered = commitCalendarOrder
      .map((id) => byId.get(id))
      .filter((calendar): calendar is (typeof writableCalendars)[number] =>
        Boolean(calendar),
      )
    const seen = new Set(commitCalendarOrder)
    for (const calendar of writableCalendars) {
      if (!seen.has(calendar.id)) ordered.push(calendar)
    }
    return ordered
  }, [writableCalendars, commitCalendarOrder])

  return (
    <aside
      className={`task-sidebar${mode === 'execution' ? ' task-sidebar-execution' : ''}`}
    >
      {mode === 'planning' && (
        <div className="task-list-header">
          <div className="task-list-brand">
            <span className="brand-mark brand-mark-sm" aria-hidden />
            <h3>Time Block</h3>
          </div>
          <div className="task-list-meta">
            <SettingsMenu
              busy={busy}
              signedIn={signedIn}
              onSignIn={onSignIn}
              onSignOut={onSignOut}
              authDiagnostics={authDiagnostics}
              authSignedIn={authSignedIn}
              authTestRefreshBusy={authTestRefreshBusy}
              onAuthTestRefresh={onAuthTestRefresh}
              blockLibrary={blockLibrary}
              onReplaceBlockLibrary={onReplaceBlockLibrary}
              plan={plan}
              onReplacePlan={onReplacePlan ?? (() => {})}
              planArchive={planArchive}
              onReplacePlanArchive={onReplacePlanArchive}
              onOpenArchivedPlans={openArchivedPlans}
              onShowNotice={onShowNotice}
              onClearNotice={onClearNotice}
              savedCalendarUsers={savedCalendarUsers}
              onReplaceSavedCalendarUsers={onReplaceSavedCalendarUsers}
              settings={settings}
              onReplaceSettings={onReplaceSettings ?? (() => {})}
              targetCalendarId={targetCalendarId}
              onTargetCalendarChange={onTargetCalendarChange}
              calendars={allCalendars}
              writableCalendars={writableCalendars}
            />
          </div>
        </div>
      )}

      <div className="block-groups" ref={blockGroupsRef}>
        {groups.map((group, index) => (
          <BlockGroupPanel
            key={group.id}
            group={group}
            collapsedLabel={group.name?.trim() || unnamedGroupLabels.get(group.id) || 'Unnamed'}
            canDeleteGroup={canDeleteGroup}
            canMoveGroupUp={index > 0}
            canMoveGroupDown={index < groups.length - 1}
            busy={busy}
            mode={mode}
            pushedEvents={pushedEvents}
            pushSnapshots={pushSnapshots}
            editingId={editingId}
            focusedTaskId={focusedTaskId}
            adding={addingGroupId === group.id && editingId === NEW_EDIT_ID}
            onEditingIdChange={onEditingIdChange}
            onStartAdd={() => {
              setAddingGroupId(group.id)
              onEditingIdChange(NEW_EDIT_ID)
            }}
            onCancelAdd={() => {
              setAddingGroupId(null)
              onEditingIdChange(null)
            }}
            onAdd={(task, index) => {
              onAdd(group.id, task, index)
              setAddingGroupId(null)
              onEditingIdChange(null)
            }}
            onUpdate={(task) => onUpdate(group.id, task)}
            onRemove={(id) => onRemove(group.id, id)}
            onReorder={(from, to) => onReorder(group.id, from, to)}
            onAnchorChange={(anchor) => onAnchorChange(group.id, anchor)}
            onDeleteGroup={() => onDeleteGroup(group.id)}
            onDuplicateGroup={() => onDuplicateGroup(group.id)}
            onArchiveGroup={() => onArchiveGroup(group.id)}
            onMoveGroupUp={() => onMoveGroup(group.id, 'up')}
            onMoveGroupDown={() => onMoveGroup(group.id, 'down')}
            onSaveCheckpoint={() => onSaveCheckpoint(group.id)}
            onRevertToCheckpoint={() => onRevertToCheckpoint(group.id)}
            onGotDelayed={() => onGotDelayed(group.id)}
            onExecutePlan={
              onExecutePlan ? () => onExecutePlan(group.id) : undefined
            }
            canExecutePlan={
              mode === 'planning' &&
              (executingGroupId === group.id ||
                (!executingGroupId && isGroupExecutableNow(group)))
            }
            isExecutingPlan={executingGroupId === group.id}
            onIntendedEndChange={
              onIntendedEndChange
                ? (iso) => onIntendedEndChange(group.id, iso)
                : undefined
            }
            onSetGroupEnabled={(enabled) => onSetGroupEnabled(group.id, enabled)}
            onOpenCommit={() => openModal('commit', group.id)}
            onDeleteFromCalendar={() => onDeleteFromCalendar(group.id)}
            onTaskEditPreview={onTaskEditPreview}
            onOpenName={() => openModal('name', group.id)}
            onSetGroupColor={(color) => onSetGroupColor(group.id, color)}
            blockLibrary={blockLibrary}
            onAddFromLibrary={(inputs, index) =>
              onAddBlocks(group.id, inputs, index)
            }
            onAddToLibrary={(task) => {
              setAddToLibraryTask(task)
              setAddToLibraryCategoryId(blockLibrary.categories[0]?.id ?? '')
              setAddToLibraryCategoryName('')
            }}
            timeStepMinutes={settings.timeStepMinutes}
            defaultBlockMinutes={settings.defaultBlockMinutes}
          />
        ))}
        {mode === 'planning' && (
          <div className="sidebar-group-actions">
            <button
              type="button"
              className="task-new-group"
              onClick={onAddGroup}
              disabled={busy}
            >
              New plan +
            </button>
            <button
              type="button"
              className="task-new-group"
              onClick={openArchivedPlans}
              disabled={busy}
            >
              Archived plans
            </button>
          </div>
        )}
      </div>

      {modal === 'commit' && modalGroup && (
        <Modal
          title={calendarCommitLabel(modalIsUpdate, modalPushedCalendarCount)}
          onClose={busy ? () => {} : closeModal}
          dialogClassName="modal-dialog-commit"
        >
          <div className="modal-form modal-form-commit">
            <div
              className="calendar-multi-select"
              role="group"
              aria-label="Calendars"
            >
              {commitCalendars.length === 0 ? (
                <p className="muted calendar-multi-select-empty">
                  Sign in to choose calendars
                </p>
              ) : (
                commitCalendars.map((calendar) => {
                  const checked = selectedCommitIds.includes(calendar.id)
                  return (
                    <CommitCalendarInvite
                      key={calendar.id}
                      calendarId={calendar.id}
                      summary={calendar.summary}
                      checked={checked}
                      busy={busy}
                      savedUsers={savedCalendarUsers}
                      guests={commitGuestsByCalendar[calendar.id] ?? []}
                      lastGuests={
                        commitLastGuestsByCalendar[calendar.id] ?? []
                      }
                      onToggle={(nextChecked) => {
                        setSelectedCommitIds((current) =>
                          nextChecked
                            ? [...current, calendar.id]
                            : current.filter((id) => id !== calendar.id),
                        )
                      }}
                      onGuestsChange={(guests) => {
                        setCommitGuestsByCalendar((current) => ({
                          ...current,
                          [calendar.id]: guests,
                        }))
                      }}
                    />
                  )
                })
              )}
            </div>
            {busy && commitProgress && (
              <div
                className="commit-progress"
                role="status"
                aria-live="polite"
                aria-busy="true"
              >
                <p className="commit-progress-label">{commitProgress.label}</p>
                <div
                  className="commit-progress-track"
                  aria-valuemin={0}
                  aria-valuemax={commitProgress.total}
                  aria-valuenow={commitProgress.current}
                  role="progressbar"
                >
                  <div
                    className="commit-progress-fill"
                    style={{
                      width: `${Math.min(
                        100,
                        (commitProgress.current / Math.max(commitProgress.total, 1)) *
                          100,
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={closeModal}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm task-new-commit"
                onClick={() => void handleCommit()}
                disabled={
                  busy ||
                  (!modalIsUpdate && modalGroup.tasks.length === 0) ||
                  (!modalIsUpdate && selectedCommitIds.length === 0)
                }
              >
                {busy
                  ? modalIsUpdate
                    ? selectedCommitIds.length > 1
                      ? 'Updating calendars'
                      : 'Updating calendar'
                    : selectedCommitIds.length > 1
                      ? 'Adding to calendars'
                      : 'Adding to calendar'
                  : calendarCommitLabel(
                      modalIsUpdate,
                      selectedCommitIds.length > 1
                        ? selectedCommitIds.length
                        : modalPushedCalendarCount,
                    )}
                {!busy && <CalendarIcon />}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'name' && modalGroup && (
        <Modal title="Rename plan" onClose={closeModal}>
          <form className="modal-form" onSubmit={handleNameGroup}>
            <label>
              <span>Name</span>
              <input
                value={groupNameInput}
                onChange={(e) => setGroupNameInput(e.target.value)}
                placeholder="Morning"
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}

      {archivedPlansOpen && (
        <ArchivedPlansModal
          archive={planArchive}
          loading={planArchiveLoading}
          onChange={onReplacePlanArchive}
          onAddToHome={handleAddFromArchive}
          onClose={() => setArchivedPlansOpen(false)}
          onShowNotice={onShowNotice}
          onClearNotice={onClearNotice}
          majorUndoSeconds={settings.majorUndoSeconds}
        />
      )}

      {blockLibraryOpen && (
        <BlockLibraryModal
          library={blockLibrary}
          onChange={onReplaceBlockLibrary}
          onClose={() => {
            setBlockLibraryOpen(false)
            setLibraryFocusBlockId(null)
          }}
          onShowNotice={onShowNotice}
          onClearNotice={onClearNotice}
          focusBlockId={libraryFocusBlockId ?? undefined}
          quickUndoSeconds={settings.quickUndoSeconds}
          majorUndoSeconds={settings.majorUndoSeconds}
        />
      )}

      {addToLibraryTask && (
        <Modal
          title="Add to block library"
          onClose={() => setAddToLibraryTask(null)}
        >
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (blockLibrary.categories.length > 0) return
              const category = {
                id: crypto.randomUUID(),
                name: addToLibraryCategoryName.trim() || 'Untitled',
                blocks: [],
              }
              onReplaceBlockLibrary(
                touchBlockLibrary([...blockLibrary.categories, category]),
              )
              setAddToLibraryCategoryId(category.id)
              setAddToLibraryCategoryName('')
            }}
          >
            {blockLibrary.categories.length === 0 ? (
              <label>
                <span>Category name</span>
                <input
                  value={addToLibraryCategoryName}
                  onChange={(e) => setAddToLibraryCategoryName(e.target.value)}
                  placeholder="Morning"
                  autoFocus
                />
              </label>
            ) : (
              <label>
                <span>Category</span>
                <select
                  value={addToLibraryCategoryId}
                  onChange={(e) => setAddToLibraryCategoryId(e.target.value)}
                  autoFocus
                >
                  {blockLibrary.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name.trim() || 'Untitled'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setAddToLibraryTask(null)}
              >
                Cancel
              </button>
              {blockLibrary.categories.length === 0 ? (
                <button type="submit" className="btn btn-primary btn-sm">
                  Create category
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!addToLibraryCategoryId}
                    onClick={() => {
                      saveTaskToLibrary(addToLibraryTask, addToLibraryCategoryId, false)
                    }}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!addToLibraryCategoryId}
                    onClick={() => {
                      saveTaskToLibrary(addToLibraryTask, addToLibraryCategoryId, true)
                    }}
                  >
                    Add and open library
                  </button>
                </>
              )}
            </div>
          </form>
        </Modal>
      )}

    </aside>
  )

  function saveTaskToLibrary(
    task: Task,
    categoryId: string,
    openLibrary: boolean,
  ) {
    const block = createSavedBlock({
      title: task.title,
      durationMinutes: task.durationMinutes,
      empty: isTaskEmpty(task) || undefined,
      note: optionalNote(task.note),
    })
    onReplaceBlockLibrary(
      touchBlockLibrary(
        blockLibrary.categories.map((category) =>
          category.id === categoryId
            ? { ...category, blocks: [...category.blocks, block] }
            : category,
        ),
      ),
    )
    setAddToLibraryTask(null)
    onShowNotice?.('Added to block library.')
    if (openLibrary) {
      setLibraryFocusBlockId(block.id)
      setBlockLibraryOpen(true)
    }
  }
}

type BlockGroupPanelProps = {
  group: BlockGroup
  collapsedLabel: string
  canDeleteGroup: boolean
  canMoveGroupUp: boolean
  canMoveGroupDown: boolean
  busy?: boolean
  mode?: 'planning' | 'execution'
  pushedEvents: PushedEvent[]
  pushSnapshots: PushSnapshot[]
  editingId: string | null
  focusedTaskId?: string | null
  adding: boolean
  onEditingIdChange: (id: string | null) => void
  onStartAdd: () => void
  onCancelAdd: () => void
  onAdd: (task: Omit<Task, 'id'>, index?: number) => void
  onUpdate: (task: Task) => void
  onRemove: (id: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onAnchorChange: (anchor: StackAnchor) => void
  onDeleteGroup: () => void
  onDuplicateGroup: () => void
  onArchiveGroup: () => void
  onMoveGroupUp: () => void
  onMoveGroupDown: () => void
  onSaveCheckpoint: () => void
  onRevertToCheckpoint: () => void
  onGotDelayed: () => void
  onExecutePlan?: () => void
  canExecutePlan?: boolean
  isExecutingPlan?: boolean
  onIntendedEndChange?: (intendedEndAt: string) => void
  onSetGroupEnabled: (enabled: boolean) => void
  onOpenCommit: () => void
  onDeleteFromCalendar: () => void
  onTaskEditPreview: (preview: {
    groupId: string
    taskId: string
    title: string
    durationMinutes: number
    empty?: boolean
  } | null) => void
  onOpenName: () => void
  onSetGroupColor: (color: string | undefined) => void
  blockLibrary: BlockLibrary
  onAddFromLibrary: (inputs: Omit<Task, 'id'>[], index?: number) => void
  onAddToLibrary: (task: Task) => void
  timeStepMinutes?: number
  defaultBlockMinutes?: number
}

function GroupColorMenuItem({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled?: boolean
  onChange: (color: string) => void
}) {
  return (
    <label className="calendar-menu-item group-color-menu-item">
      <span>Change color</span>
      <input
        type="color"
        value={value}
        disabled={disabled}
        aria-label="Plan color"
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

/** Run on pointer down so a scroll-repositioned menu still activates. */
function planMenuItemProps(run: () => void) {
  return {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      run()
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      run()
    },
  }
}

function BlockGroupPanel({
  group,
  collapsedLabel,
  canDeleteGroup,
  canMoveGroupUp,
  canMoveGroupDown,
  busy,
  mode = 'planning',
  pushedEvents,
  pushSnapshots,
  editingId,
  focusedTaskId = null,
  adding,
  onEditingIdChange,
  onStartAdd,
  onCancelAdd,
  onAdd,
  onUpdate,
  onRemove,
  onReorder,
  onAnchorChange,
  onDeleteGroup,
  onDuplicateGroup,
  onArchiveGroup,
  onMoveGroupUp,
  onMoveGroupDown,
  onSaveCheckpoint,
  onRevertToCheckpoint,
  onGotDelayed,
  onExecutePlan,
  canExecutePlan = false,
  isExecutingPlan = false,
  onIntendedEndChange,
  onSetGroupEnabled,
  onOpenCommit,
  onDeleteFromCalendar,
  onTaskEditPreview,
  onOpenName,
  onSetGroupColor,
  blockLibrary,
  onAddFromLibrary,
  onAddToLibrary,
  timeStepMinutes = 5,
  defaultBlockMinutes = 30,
}: BlockGroupPanelProps) {
  const { tasks, anchor } = group
  const enabled = isGroupEnabled(group)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [insertDragSource, setInsertDragSource] = useState<
    'library' | 'custom' | null
  >(null)
  const [dropLineIndex, setDropLineIndex] = useState<number | null>(null)
  const [pendingInsertIndex, setPendingInsertIndex] = useState<number | null>(
    null,
  )
  const [customInsertIndex, setCustomInsertIndex] = useState<number | null>(
    null,
  )
  const [listMenuOpen, setListMenuOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [librarySelection, setLibrarySelection] = useState<string[]>([])
  const [focusNoteOnEdit, setFocusNoteOnEdit] = useState(false)

  const listRef = useRef<HTMLUListElement>(null)
  const listMenuRef = useRef<HTMLDivElement>(null)
  const listMenu = useFixedMenu({
    open: listMenuOpen,
    align: 'end',
    constrainHeight: true,
    onClose: () => setListMenuOpen(false),
  })
  const libraryMenuRef = useRef<HTMLDivElement>(null)
  const libraryMenu = useFixedMenu({
    open: libraryOpen,
    align: 'start',
    constrainHeight: true,
    matchTriggerWidth: true,
    minWidth: 224,
    maxWidth: 288,
    onClose: () => {
      setLibraryOpen(false)
      setPendingInsertIndex(null)
    },
  })
  const dropLineIndexRef = useRef<number | null>(null)
  const insertDragSourceRef = useRef<'library' | 'custom' | null>(null)
  const insertDragXRef = useRef(0)
  const insertDragYRef = useRef(0)
  const suppressClickRef = useRef(false)
  const timePointerActiveRef = useRef(false)
  const tasksLengthRef = useRef(tasks.length)
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor
  const intendedEndAtRef = useRef(group.intendedEndAt)
  intendedEndAtRef.current = group.intendedEndAt
  const [nowMs, setNowMs] = useState(() => Date.now())
  const dropLineActive = dragIndex !== null || insertDragSource !== null

  useEffect(() => {
    if (mode !== 'execution') return
    setNowMs(Date.now())
    const id = window.setInterval(() => setNowMs(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [mode])

  useEffect(() => {
    dropLineIndexRef.current = dropLineIndex
  }, [dropLineIndex])

  useEffect(() => {
    tasksLengthRef.current = tasks.length
  }, [tasks.length])

  useEffect(() => {
    if (!focusedTaskId || !tasks.some((t) => t.id === focusedTaskId)) return
    const card = listRef.current?.querySelector<HTMLElement>(
      `[data-task-id="${CSS.escape(focusedTaskId)}"]`,
    )
    if (card) scrollTaskIntoViewWithMargin(card)
  }, [focusedTaskId, tasks])

  useEffect(() => {
    if (!editingId || editingId === NEW_EDIT_ID) return
    if (!tasks.some((t) => t.id === editingId)) return
    const card = listRef.current?.querySelector(
      `[data-task-id="${CSS.escape(editingId)}"]`,
    )
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [editingId, tasks])

  const colorPickerValue =
    group.color && /^#[0-9a-fA-F]{6}$/.test(group.color)
      ? group.color
      : DEFAULT_GROUP_COLOR

  function handleColorChange(next: string) {
    onSetGroupColor(next === DEFAULT_GROUP_COLOR ? undefined : next)
  }

  function toggleLibraryBlock(categoryId: string, blockId: string) {
    const key = blockLibraryKey(categoryId, blockId)
    setLibrarySelection((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key)
      return [...prev, key]
    })
  }

  function handleAddFromLibrary() {
    const blocks = resolveSavedBlocksFromKeys(blockLibrary, librarySelection)
    if (blocks.length === 0) return
    onAddFromLibrary(
      blocks.map((b) => ({
        title: b.title,
        durationMinutes: b.durationMinutes,
        ...(b.empty ? { empty: true } : {}),
        ...(b.note ? { note: b.note } : {}),
      })),
      pendingInsertIndex ?? tasks.length,
    )
    setLibrarySelection([])
    setPendingInsertIndex(null)
    setLibraryOpen(false)
  }

  function handlePowerChange(nextEnabled: boolean) {
    onSetGroupEnabled(nextEnabled)
  }

  const resolved = useMemo(
    () => resolveStack(tasks, anchor),
    [tasks, anchor],
  )
  const currentTaskId =
    mode === 'execution'
      ? (resolved.find(
          (task) =>
            !isTaskDisabled(task) &&
            task.start.getTime() <= nowMs &&
            nowMs < task.end.getTime(),
        )?.id ?? null)
      : null
  const activeResolved = useMemo(
    () => resolved.filter((task) => !isTaskDisabled(task)),
    [resolved],
  )
  const stackBoundaryOffsets = stackDayBoundaryOffsets({ tasks, anchor })
  const stackSummary =
    activeResolved.length === 0 ? null : (
      <>
        <span>
          {timeFmt.format(activeResolved[0]!.start)}
          {stackBoundaryOffsets.startPreviousDay && (
            <sup
              className="task-range-day-offset"
              title="This start time is yesterday"
            >
              -1
            </sup>
          )}
        </span>{' '}
        –{' '}
        <span>
          {timeFmt.format(activeResolved[activeResolved.length - 1]!.end)}
          {stackBoundaryOffsets.endNextDay && (
            <span
              className="task-range-day-offset"
              title="This end time is tomorrow"
            >
              +1
            </span>
          )}
        </span>
      </>
    )
  const dayKey = localDateKey(anchor.at)
  const onCalendar = hasPushedGroupOnDay(pushedEvents, group.id, dayKey)
  const isUpdate = onCalendar
  const commitLabel = calendarCommitLabel(
    isUpdate,
    pushedCalendarIdsForGroupDay(pushedEvents, group.id, dayKey).length,
  )
  const endStatus =
    mode === 'execution' ? getStackEndStatus(group) : null
  const stackEndMs =
    mode === 'execution'
      ? (activeResolved.at(-1) ?? resolved.at(-1))?.end.getTime() ?? null
      : null
  const hasEnded = stackEndMs != null && nowMs >= stackEndMs
  const endingVerb = hasEnded ? 'Ended' : 'Ending'
  const groupStyle = {
    ['--group-accent' as string]: groupSidebarAccentColor(group.color),
  }

  useEffect(() => {
    if (mode !== 'execution' || stackEndMs == null || hasEnded) return
    const delay = Math.max(0, stackEndMs - Date.now()) + 25
    const id = window.setTimeout(() => setNowMs(Date.now()), delay)
    return () => window.clearTimeout(id)
  }, [mode, stackEndMs, hasEnded])
  const totalDurationMinutes = stackDurationMinutes(tasks)
  const hasCheckpointDrift = Boolean(
    group.checkpoint &&
      !groupMatchesCheckpoint(
        { tasks, anchor },
        group.checkpoint,
      ),
  )
  const showSaveCheckpoint = !group.checkpoint || hasCheckpointDrift

  function renderListMenuDropdown() {
    return (
      <FixedMenuPortal
        open={listMenuOpen}
        dropdownRef={listMenu.dropdownRef}
        style={listMenu.style}
        className="task-new-menu-dropdown"
      >
        {enabled && showSaveCheckpoint && (
          <>
            <button
              type="button"
              role="menuitem"
              className="calendar-menu-item"
              disabled={busy || tasks.length === 0}
              {...planMenuItemProps(() => {
                setListMenuOpen(false)
                onSaveCheckpoint()
              })}
            >
              {group.checkpoint ? 'Update default' : 'Save as default'}
            </button>
            <div className="calendar-menu-sep" role="separator" />
          </>
        )}
        <button
          type="button"
          role="menuitem"
          className="calendar-menu-item"
          disabled={busy}
          {...planMenuItemProps(() => {
            setListMenuOpen(false)
            onOpenName()
          })}
        >
          Rename
        </button>
        <GroupColorMenuItem
          value={colorPickerValue}
          disabled={busy}
          onChange={handleColorChange}
        />
        {(canMoveGroupUp || canMoveGroupDown) && (
          <>
            <div className="calendar-menu-sep" role="separator" />
            {canMoveGroupUp && (
              <button
                type="button"
                role="menuitem"
                className="calendar-menu-item"
                disabled={busy}
                {...planMenuItemProps(() => {
                  setListMenuOpen(false)
                  onMoveGroupUp()
                })}
              >
                Move up
              </button>
            )}
            {canMoveGroupDown && (
              <button
                type="button"
                role="menuitem"
                className="calendar-menu-item"
                disabled={busy}
                {...planMenuItemProps(() => {
                  setListMenuOpen(false)
                  onMoveGroupDown()
                })}
              >
                Move down
              </button>
            )}
          </>
        )}
        <button
          type="button"
          role="menuitem"
          className="calendar-menu-item"
          disabled={busy}
          {...planMenuItemProps(() => {
            setListMenuOpen(false)
            onDuplicateGroup()
          })}
        >
          Duplicate
        </button>
        {mode !== 'execution' && (
          <>
            <div className="calendar-menu-sep" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="calendar-menu-item"
              disabled={busy || !canDeleteGroup || isExecutingPlan}
              title={
                isExecutingPlan
                  ? 'End run first.'
                  : !canDeleteGroup
                    ? 'Keep at least one plan.'
                    : undefined
              }
              {...planMenuItemProps(() => {
                setListMenuOpen(false)
                onArchiveGroup()
              })}
            >
              Archive
            </button>
            <button
              type="button"
              role="menuitem"
              className="calendar-menu-item"
              disabled={busy || !canDeleteGroup}
              {...planMenuItemProps(() => {
                setListMenuOpen(false)
                onDeleteGroup()
              })}
            >
              Delete
            </button>
          </>
        )}
        {enabled && (
          <>
            <div className="calendar-menu-sep" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="calendar-menu-item"
              disabled={busy || !onCalendar}
              {...planMenuItemProps(() => {
                setListMenuOpen(false)
                void onDeleteFromCalendar()
              })}
            >
              Delete from calendar
            </button>
          </>
        )}
      </FixedMenuPortal>
    )
  }

  function renderListMenu() {
    return (
      <div className="task-new-menu" ref={listMenuRef}>
        <button
          type="button"
          ref={listMenu.triggerRef}
          className="btn btn-text btn-icon task-new-menu-btn"
          aria-label="Plan options"
          aria-expanded={listMenuOpen}
          aria-haspopup="true"
          disabled={busy}
          onClick={() => setListMenuOpen((open) => !open)}
        >
          ···
        </button>
        {renderListMenuDropdown()}
      </div>
    )
  }

  function beginTimeScrub(
    e: React.PointerEvent<HTMLInputElement>,
    getBaseIso: () => string,
    onIsoChange: (iso: string) => void,
  ) {
    if (e.button !== 0) return
    const input = e.currentTarget
    const startY = e.clientY
    const startX = e.clientX
    const pointerId = e.pointerId
    let active = false
    let lastTick = 0
    let field: AnchorField = 'minute'
    // Prefer React state over input.value — native minute-segment UI can
    // wrap :00→:55 in the DOM before our scrub activates.
    const originIso = getBaseIso()
    timePointerActiveRef.current = true
    window.getSelection()?.removeAllRanges()

    function isoForTick(tick: number): string {
      return stepLocalTime(originIso, field, tick, timeStepMinutes)
    }

    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!active) {
        if (Math.abs(dy) < ANCHOR_SCRUB_ACTIVATE_PX) return
        if (Math.abs(dy) < Math.abs(dx)) {
          cleanup()
          return
        }
        active = true
        field = anchorFieldFromSelection(readSelectionStart(input))
        document.body.classList.add('is-datetime-scrubbing')
        window.getSelection()?.removeAllRanges()
        input.blur()
        try {
          input.setPointerCapture(pointerId)
        } catch {
          /* ignore */
        }
      }
      ev.preventDefault()
      window.getSelection()?.removeAllRanges()
      const tick = Math.trunc(-dy / ANCHOR_SCRUB_PX)
      if (tick === lastTick) return
      lastTick = tick
      onIsoChange(isoForTick(tick))
    }

    function cleanup() {
      timePointerActiveRef.current = false
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('is-datetime-scrubbing')
      try {
        if (input.hasPointerCapture(pointerId)) {
          input.releasePointerCapture(pointerId)
        }
      } catch {
        /* ignore */
      }
    }

    function onUp(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return
      cleanup()
    }

    document.addEventListener('pointermove', onMove, { passive: false })
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
  }

  function applyTimeInputChange(
    value: string,
    baseIso: string,
    onIsoChange: (iso: string) => void,
  ) {
    if (!value) return
    if (
      timePointerActiveRef.current ||
      document.body.classList.contains('is-datetime-scrubbing')
    ) {
      return
    }
    onIsoChange(fromLocalTimeValue(value, baseIso))
  }

  function handleTimeKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    baseIso: string,
    onIsoChange: (iso: string) => void,
  ) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const field = anchorFieldFromSelection(readSelectionStart(e.currentTarget))
    const steps = e.key === 'ArrowUp' ? 1 : -1
    onIsoChange(stepLocalTime(baseIso, field, steps, timeStepMinutes))
  }

  function beginAnchorScrub(e: React.PointerEvent<HTMLInputElement>) {
    beginTimeScrub(
      e,
      () => anchorRef.current.at,
      (iso) => onAnchorChange({ ...anchorRef.current, at: iso }),
    )
  }

  function beginIntendedEndScrub(e: React.PointerEvent<HTMLInputElement>) {
    if (!onIntendedEndChange) return
    beginTimeScrub(
      e,
      () => intendedEndAtRef.current || anchorRef.current.at,
      (iso) => onIntendedEndChange(iso),
    )
  }

  function handleDropAt(insertAt: number, from: number) {
    setDragIndex(null)
    setDropLineIndex(null)
    const len = tasksLengthRef.current
    if (!Number.isInteger(from) || from < 0 || from >= len) return
    if (insertAt === from || insertAt === from + 1) return
    const to = from < insertAt ? insertAt - 1 : insertAt
    onReorder(from, to)
  }

  function lineIndexFromY(clientY: number): number {
    const list = listRef.current
    if (!list) return 0
    const cards = list.querySelectorAll<HTMLElement>('[data-task-index]')
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i]!.getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) return i
    }
    return cards.length
  }

  function insertionIndexAtPoint(clientX: number, clientY: number): number | null {
    const list = listRef.current
    if (!list) return null
    const rect = list.getBoundingClientRect()
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null
    }
    return lineIndexFromY(clientY)
  }

  function showDropLineAt(index: number): boolean {
    if (dropLineIndex !== index || !dropLineActive) return false
    return dragIndex === null || (index !== dragIndex && index !== dragIndex + 1)
  }

  function beginTaskDrag(
    e: React.PointerEvent<HTMLElement>,
    index: number,
  ) {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    suppressClickRef.current = false

    attachReorderDragListeners({
      handle: e.currentTarget,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      onActivate: () => {
        dropLineIndexRef.current = index
        setDragIndex(index)
        setDropLineIndex(index)
        document.body.classList.add('is-task-reordering')
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate?.(12)
        }
      },
      onMove: (ev) => {
        const nextLine = lineIndexFromY(ev.clientY)
        if (dropLineIndexRef.current !== nextLine) {
          dropLineIndexRef.current = nextLine
          setDropLineIndex(nextLine)
        }
      },
      onEnd: (ev, didActivate) => {
        if (didActivate) {
          const insertAt =
            dropLineIndexRef.current ?? lineIndexFromY(ev.clientY)
          handleDropAt(insertAt, index)
        }
        document.body.classList.remove('is-task-reordering')
        setDragIndex(null)
        setDropLineIndex(null)
        dropLineIndexRef.current = null
      },
      onSuppressClick: () => {
        suppressClickRef.current = true
      },
      autoScroll: true,
      onAutoScroll: (clientY) => {
        const nextLine = lineIndexFromY(clientY)
        if (dropLineIndexRef.current !== nextLine) {
          dropLineIndexRef.current = nextLine
          setDropLineIndex(nextLine)
        }
      },
    })
  }

  function beginInsertDrag(
    e: React.PointerEvent<HTMLButtonElement>,
    source: 'library' | 'custom',
  ) {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    suppressClickRef.current = false
    insertDragSourceRef.current = null
    insertDragXRef.current = e.clientX
    insertDragYRef.current = e.clientY

    attachReorderDragListeners({
      handle: e.currentTarget,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      onActivate: () => {
        const index = insertionIndexAtPoint(e.clientX, e.clientY)
        insertDragSourceRef.current = source
        setInsertDragSource(source)
        dropLineIndexRef.current = index
        setDropLineIndex(index)
        document.body.classList.add('is-task-reordering')
      },
      onMove: (ev) => {
        insertDragXRef.current = ev.clientX
        insertDragYRef.current = ev.clientY
        const index = insertionIndexAtPoint(ev.clientX, ev.clientY)
        if (dropLineIndexRef.current !== index) {
          dropLineIndexRef.current = index
          setDropLineIndex(index)
        }
      },
      onEnd: (ev, didActivate) => {
        const index = didActivate
          ? insertionIndexAtPoint(ev.clientX, ev.clientY)
          : null
        const droppedSource = insertDragSourceRef.current
        insertDragSourceRef.current = null
        document.body.classList.remove('is-task-reordering')
        setInsertDragSource(null)
        setDropLineIndex(null)
        dropLineIndexRef.current = null
        if (index == null || !droppedSource) return
        setPendingInsertIndex(index)
        if (droppedSource === 'library') {
          setLibrarySelection([])
          setLibraryOpen(true)
          setListMenuOpen(false)
        } else {
          setCustomInsertIndex(index)
          onStartAdd()
        }
      },
      onSuppressClick: () => {
        suppressClickRef.current = true
      },
      autoScroll: true,
      onAutoScroll: () => {
        const index = insertionIndexAtPoint(
          insertDragXRef.current,
          insertDragYRef.current,
        )
        if (dropLineIndexRef.current !== index) {
          dropLineIndexRef.current = index
          setDropLineIndex(index)
        }
      },
    })
  }

  function clearCustomAdd() {
    setCustomInsertIndex(null)
    setPendingInsertIndex(null)
    onCancelAdd()
  }

  function renderCustomAddEditor() {
    return (
      <TaskFieldsForm
        initialTitle=""
        initialDuration={defaultBlockMinutes}
        stepMinutes={timeStepMinutes}
        submitLabel="Add"
        busy={busy}
        onCancel={clearCustomAdd}
        onSubmit={(next) => {
          onAdd(
            {
              title: next.title,
              durationMinutes: next.durationMinutes,
              ...(next.empty ? { empty: true } : {}),
              ...(next.note ? { note: next.note } : {}),
            },
            customInsertIndex ?? tasks.length,
          )
          setCustomInsertIndex(null)
          setPendingInsertIndex(null)
        }}
      />
    )
  }

  if (!enabled && mode !== 'execution') {
    return (
      <section
        className={[
          'block-group',
          'block-group-collapsed',
          'block-group-disabled',
          isExecutingPlan ? 'block-group-running' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-group-id={group.id}
        style={groupStyle}
      >
        <div className="block-group-collapsed-row">
          <button
            type="button"
            className="block-group-header"
            onClick={() => onSetGroupEnabled(true)}
            disabled={busy}
            aria-expanded={false}
            aria-label={
              isExecutingPlan
                ? 'Expand running plan'
                : 'Expand plan'
            }
            title={
              isExecutingPlan
                ? 'Expand running plan'
                : 'Expand plan'
            }
          >
            <span className="block-group-collapsed-title">
              {collapsedLabel}
              {totalDurationMinutes > 0 && (
                <span className="block-group-collapsed-count">
                  {' '}
                  ({formatDurationMinutes(totalDurationMinutes)})
                </span>
              )}
            </span>
          </button>
          {canExecutePlan && onExecutePlan && (
            <button
              type="button"
              className="btn btn-primary btn-sm execution-start-btn"
              disabled={busy}
              onClick={onExecutePlan}
            >
              {isExecutingPlan ? 'Running' : 'Start plan'}
            </button>
          )}
          {renderListMenu()}
        </div>
      </section>
    )
  }

  return (
    <section className="block-group" data-group-id={group.id} style={groupStyle}>
      <div className="stack-anchor">
        {mode !== 'execution' && (
          <div className="stack-anchor-name-row">
            <button
              type="button"
              className="block-group-header"
              onClick={() => handlePowerChange(false)}
              disabled={busy}
              aria-expanded={true}
              aria-label="Collapse plan"
              title="Collapse plan"
            >
              <span className="stack-anchor-name">{collapsedLabel}</span>
            </button>
            {canExecutePlan && onExecutePlan && (
              <button
                type="button"
                className="btn btn-primary btn-sm execution-start-btn"
                disabled={busy}
                onClick={onExecutePlan}
              >
                {isExecutingPlan ? 'Running' : 'Start plan'}
              </button>
            )}
            {renderListMenu()}
          </div>
        )}
        <div className="stack-anchor-row">
          {mode === 'execution' ? (
            <>
              <div className="stack-anchor-times">
                <span className="execution-started-label">Start</span>
                <label className="stack-anchor-time">
                  <span className="sr-only">List starts at</span>
                  <input
                    type="time"
                    step={timeStepMinutes * 60}
                    value={toLocalTimeValue(anchor.at)}
                    onChange={(e) => {
                      applyTimeInputChange(e.target.value, anchor.at, (iso) =>
                        onAnchorChange({ ...anchor, at: iso }),
                      )
                    }}
                    onKeyDown={(e) =>
                      handleTimeKeyDown(e, anchor.at, (iso) =>
                        onAnchorChange({ ...anchor, at: iso }),
                      )
                    }
                    onPointerDown={beginAnchorScrub}
                  />
                </label>
                {group.intendedEndAt && onIntendedEndChange && (
                  <>
                    <span className="execution-times-gap" aria-hidden="true" />
                    <span className="execution-started-label">Intended End</span>
                    <label className="stack-anchor-time execution-delay-intended">
                      <span className="sr-only">Intended end time</span>
                      <input
                        type="time"
                        step={timeStepMinutes * 60}
                        value={toLocalTimeValue(group.intendedEndAt)}
                        disabled={busy}
                        onChange={(e) => {
                          if (!group.intendedEndAt) return
                          applyTimeInputChange(
                            e.target.value,
                            group.intendedEndAt,
                            onIntendedEndChange,
                          )
                        }}
                        onKeyDown={(e) => {
                          if (!group.intendedEndAt) return
                          handleTimeKeyDown(
                            e,
                            group.intendedEndAt,
                            onIntendedEndChange,
                          )
                        }}
                        onPointerDown={beginIntendedEndScrub}
                      />
                    </label>
                  </>
                )}
              </div>
              {renderListMenu()}
            </>
          ) : (
            <>
              <div className="segmented segmented-sm segmented-single">
                <button
                  type="button"
                  className="active"
                  disabled={busy}
                  aria-pressed={anchor.kind === 'end'}
                  aria-label={
                    anchor.kind === 'end'
                      ? 'Ends at selected time; tap to anchor from start'
                      : 'Starts at selected time; tap to anchor from end'
                  }
                  onClick={() =>
                    onAnchorChange(
                      toggleAnchorPreservingStack(anchor, totalDurationMinutes),
                    )
                  }
                >
                  {anchor.kind === 'start' ? 'Starts' : 'Ends'}
                </button>
              </div>
              <span className="muted stack-anchor-at" aria-hidden="true">
                at
              </span>
              <label className="stack-anchor-time">
                <span className="sr-only">
                  {anchor.kind === 'start' ? 'List starts at' : 'List ends at'}
                </span>
                <input
                  type="time"
                  step={timeStepMinutes * 60}
                  value={toLocalTimeValue(anchor.at)}
                  onChange={(e) => {
                    applyTimeInputChange(e.target.value, anchor.at, (iso) =>
                      onAnchorChange({ ...anchor, at: iso }),
                    )
                  }}
                  onKeyDown={(e) =>
                    handleTimeKeyDown(e, anchor.at, (iso) =>
                      onAnchorChange({ ...anchor, at: iso }),
                    )
                  }
                  onPointerDown={beginAnchorScrub}
                />
              </label>
              {stackSummary && (
                <span className="task-range muted">{stackSummary}</span>
              )}
            </>
          )}
        </div>
        {mode === 'execution' && resolved.length > 0 && (
          <div
            className={[
              'stack-anchor-row',
              'execution-end-row',
              endStatus?.kind === 'late'
                ? 'execution-end-row-late'
                : endStatus
                  ? 'execution-end-row-ok'
                  : '',
            ]
              .filter(Boolean)
              .join(' ')}
            role={endStatus ? 'status' : undefined}
          >
            {endStatus?.kind === 'late' ? (
              <span className="execution-ending-copy">
                {endingVerb} late at{' '}
                <strong>{timeFmt.format(endStatus.actualEnd)}</strong>{' '}
                ({formatDurationMinutes(endStatus.delayedMinutes)} late)
              </span>
            ) : endStatus?.kind === 'early' ? (
              <span className="execution-ending-copy">
                <span className="execution-early-stars" aria-hidden="true">
                  ✨
                </span>{' '}
                {endingVerb} early at{' '}
                <strong>{timeFmt.format(endStatus.actualEnd)}</strong>{' '}
                ({formatDurationMinutes(endStatus.earlyMinutes)} early)
              </span>
            ) : endStatus?.kind === 'on-time' ? (
              <span className="execution-ending-copy">
                {endingVerb} on time at{' '}
                <strong>{timeFmt.format(endStatus.actualEnd)}</strong>
              </span>
            ) : (
              <span className="execution-ending-copy">
                {endingVerb} at{' '}
                <strong>
                  {timeFmt.format(
                    (activeResolved[activeResolved.length - 1] ??
                      resolved[resolved.length - 1])!.end,
                  )}
                </strong>
              </span>
            )}
          </div>
        )}
        {mode === 'execution' && (
          <div className="execution-action-row">
            <button
              type="button"
              className="btn btn-ghost btn-sm execution-delayed-btn"
              disabled={busy}
              title="Insert an empty delay so later blocks shift later"
              onClick={onGotDelayed}
            >
              I’m delayed
              <DelayedIcon />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm task-new-commit"
              onClick={onOpenCommit}
              disabled={busy || (!isUpdate && tasks.length === 0)}
            >
              {commitLabel}
              <CalendarIcon />
            </button>
          </div>
        )}
      </div>

      <ul className="task-list" ref={listRef}>
        {tasks.map((task, index) => {
          const editing = editingId === task.id
          const resolvedTask = resolved.find((r) => r.id === task.id)
          const pushed =
            !isTaskEmpty(task) &&
            !isTaskDisabled(task) &&
            hasPushedTaskOnDay(pushedEvents, task.id, dayKey)
          const synced =
            pushed &&
            resolvedTask != null &&
            isTaskPushUnchanged(
              pushedEvents,
              pushSnapshots,
              group.id,
              dayKey,
              resolvedTask,
            )
          const showLineBefore = showDropLineAt(index)
          const note = optionalNote(task.note)

          function toggleTaskDone() {
            if (consumeReorderClickSuppression(suppressClickRef)) return
            if (isTaskDelay(task)) return
            if (task.done) {
              const { done: _d, ...rest } = task
              onUpdate(rest)
            } else {
              onUpdate({ ...task, done: true })
            }
          }

          return (
            <Fragment key={task.id}>
              {adding && customInsertIndex === index && (
                <li className="task-card task-card-new is-editing">
                  {renderCustomAddEditor()}
                </li>
              )}
              <li
                data-task-index={index}
                data-task-id={task.id}
                className={[
                'task-card',
                dragIndex === index ? 'is-dragging' : '',
                focusedTaskId === task.id ? 'is-calendar-focused' : '',
                showLineBefore ? 'drop-line-before' : '',
                editing ? 'is-editing' : '',
                isTaskEmpty(task) && !editing ? 'task-card-empty' : '',
                isTaskDisabled(task) && !editing ? 'task-card-disabled' : '',
                currentTaskId === task.id ? 'task-card-current' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {editing ? (
                <TaskFieldsForm
                  initialTitle={task.title}
                  initialDuration={task.durationMinutes}
                  initialEmpty={task.empty === true}
                  initialNote={task.note ?? ''}
                  autoFocusNote={focusNoteOnEdit}
                  autoFocusDuration={!focusNoteOnEdit}
                  stepMinutes={timeStepMinutes}
                  submitLabel="Save"
                  busy={busy}
                  previewGroupId={group.id}
                  previewTaskId={task.id}
                  onTaskEditPreview={onTaskEditPreview}
                  onCancel={() => {
                    setFocusNoteOnEdit(false)
                    onEditingIdChange(null)
                  }}
                  onSubmit={(next) => {
                    const updated: Task = {
                      ...task,
                      title: next.title,
                      durationMinutes: next.durationMinutes,
                    }
                    if (next.empty) updated.empty = true
                    else delete updated.empty
                    if (next.note) updated.note = next.note
                    else delete updated.note
                    onUpdate(updated)
                    setFocusNoteOnEdit(false)
                    onEditingIdChange(null)
                  }}
                />
              ) : (
                <>
                  {mode === 'execution' &&
                    (isTaskDelay(task) ? (
                      <span className="task-done-btn-spacer" aria-hidden />
                    ) : (
                    <button
                      type="button"
                      className={[
                        'task-done-btn',
                        task.done ? 'is-done' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-label={
                        task.done
                          ? `Mark ${task.title} not finished`
                          : `Mark ${task.title} finished`
                      }
                      aria-pressed={task.done === true}
                      title={task.done ? 'Finished' : 'Pending'}
                      onClick={toggleTaskDone}
                    >
                      {task.done ? <FinishedCheckIcon /> : <PendingIcon />}
                    </button>
                    ))}
                  <div
                    className="task-card-main task-card-drag"
                    onPointerDown={(e) => beginTaskDrag(e, index)}
                    onClick={() => {
                      if (consumeReorderClickSuppression(suppressClickRef)) return
                      setFocusNoteOnEdit(false)
                      onEditingIdChange(task.id)
                    }}
                  >
                    <span className="task-title">
                      <span className="task-title-text">{task.title}</span>
                      <span className="muted task-duration">
                        · {formatDurationMinutes(task.durationMinutes)}
                      </span>
                      {note && (
                        <span
                          className="task-note-icon"
                          title={note}
                          aria-hidden
                        >
                          <NoteIcon />
                        </span>
                      )}
                      {pushed &&
                        (synced ? (
                          <TaskSyncedCheckIcon title="Matches Google Calendar" />
                        ) : (
                          <CalendarSyncedIcon title="On Google Calendar — tap Update to sync changes" />
                        ))}
                    </span>
                  </div>
                  <div
                    className="task-card-icons"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={
                        isTaskDelay(task)
                          ? 'Delays can’t be disabled'
                          : isTaskDisabled(task)
                            ? `Enable ${task.title}`
                            : `Disable ${task.title}`
                      }
                      aria-pressed={isTaskDisabled(task)}
                      title={
                        isTaskDelay(task)
                          ? 'Delays can’t be disabled'
                          : isTaskDisabled(task)
                            ? 'Enable'
                            : 'Disable'
                      }
                      disabled={isTaskDelay(task)}
                      onClick={() => {
                        if (consumeReorderClickSuppression(suppressClickRef)) return
                        if (isTaskDelay(task)) return
                        if (isTaskDisabled(task)) {
                          const { disabled: _d, ...rest } = task
                          onUpdate(rest)
                        } else {
                          onUpdate({ ...task, disabled: true })
                        }
                      }}
                    >
                      <DisableBlockIcon crossedOut={isTaskDisabled(task)} />
                    </button>
                    <TaskBlockMenu
                      task={task}
                      showAddToLibrary={
                        !isTaskDelay(task) &&
                        !isTaskInBlockLibrary(blockLibrary, task)
                      }
                      onEdit={() => {
                        setFocusNoteOnEdit(false)
                        onEditingIdChange(task.id)
                      }}
                      onAddNote={() => {
                        setFocusNoteOnEdit(true)
                        onEditingIdChange(task.id)
                      }}
                      onAddToLibrary={() => onAddToLibrary(task)}
                      onRemove={() => onRemove(task.id)}
                      onOpen={() => {
                        setListMenuOpen(false)
                        setLibraryOpen(false)
                      }}
                      suppressClickRef={suppressClickRef}
                    />
                  </div>
                </>
              )}
              </li>
            </Fragment>
          )
        })}

        {(!adding || customInsertIndex === tasks.length) && (
          <li
            className={[
              'task-card',
              'task-card-new',
            adding ? 'is-editing' : '',
            showDropLineAt(tasks.length) ? 'drop-line-before' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {adding ? renderCustomAddEditor() : (
            <div className="task-new-row">
              <div className="task-new-triggers">
                <div className="task-new-menu task-new-library" ref={libraryMenuRef}>
                  <button
                    ref={libraryMenu.triggerRef}
                    type="button"
                    className={`task-new-trigger${insertDragSource === 'library' ? ' is-dragging' : ''}`}
                    disabled={busy}
                    onPointerDown={(e) => beginInsertDrag(e, 'library')}
                    aria-expanded={libraryOpen}
                    aria-haspopup="listbox"
                    onClick={() => {
                      if (consumeReorderClickSuppression(suppressClickRef)) return
                      setPendingInsertIndex(null)
                      setLibraryOpen((open) => !open)
                      setListMenuOpen(false)
                    }}
                  >
                    <LibraryIcon />
                    <span className="task-new-trigger-label">Library block</span>
                  </button>
                  <FixedMenuPortal
                    open={libraryOpen}
                    dropdownRef={libraryMenu.dropdownRef}
                    style={libraryMenu.style}
                    className="task-new-menu-dropdown block-library-picker"
                    role="listbox"
                    aria-multiselectable
                  >
                        <div className="block-library-picker-list">
                          {blockLibrary.categories.length === 0 ? (
                            <p className="muted block-library-picker-empty">
                              No saved blocks yet. Add some from the menu →
                              Block library.
                            </p>
                          ) : (
                            blockLibrary.categories.map((category) => (
                              <div
                                key={category.id}
                                className="block-library-picker-category"
                              >
                                <div className="block-library-picker-category-name">
                                  {category.name}
                                </div>
                                {category.blocks.map((block) => {
                                  const key = blockLibraryKey(
                                    category.id,
                                    block.id,
                                  )
                                  const order = librarySelection.indexOf(key)
                                  const selected = order >= 0
                                  const note = optionalNote(block.note)
                                  return (
                                    <button
                                      key={block.id}
                                      type="button"
                                      role="option"
                                      aria-selected={selected}
                                      className={[
                                        'block-library-picker-item',
                                        selected ? 'is-selected' : '',
                                        isTaskEmpty(block) ? 'is-empty' : '',
                                      ]
                                        .filter(Boolean)
                                        .join(' ')}
                                      onClick={() =>
                                        toggleLibraryBlock(
                                          category.id,
                                          block.id,
                                        )
                                      }
                                    >
                                      {selected && (
                                        <span className="block-library-picker-order">
                                          {order + 1}
                                        </span>
                                      )}
                                      <span className="block-library-picker-title">
                                        {block.title}
                                      </span>
                                      <span className="block-library-picker-meta">
                                        {note && (
                                          <span
                                            className="task-note-icon"
                                            title={note}
                                            aria-hidden
                                          >
                                            <NoteIcon />
                                          </span>
                                        )}
                                        <span className="muted block-library-picker-duration">
                                          {formatDurationMinutes(
                                            block.durationMinutes,
                                          )}
                                        </span>
                                      </span>
                                    </button>
                                  )
                                })}
                              </div>
                            ))
                          )}
                        </div>
                        <div className="block-library-picker-actions">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busy || librarySelection.length === 0}
                            onClick={handleAddFromLibrary}
                          >
                            {librarySelection.length === 1
                              ? 'Add 1 block'
                              : librarySelection.length > 1
                                ? `Add ${librarySelection.length} blocks`
                                : 'Add blocks'}
                          </button>
                        </div>
                      </FixedMenuPortal>
                </div>
                <button
                  type="button"
                  className={`task-new-trigger task-new-trigger-secondary${insertDragSource === 'custom' ? ' is-dragging' : ''}`}
                  onPointerDown={(e) => beginInsertDrag(e, 'custom')}
                  onClick={() => {
                    if (consumeReorderClickSuppression(suppressClickRef)) return
                    setPendingInsertIndex(null)
                    setCustomInsertIndex(tasks.length)
                    onStartAdd()
                  }}
                  disabled={busy}
                >
                  <BlockIcon />
                  <span className="task-new-trigger-label">Custom</span>
                </button>
              </div>
            </div>
          )}
          </li>
        )}
      </ul>
      {mode !== 'execution' && (
        <div className="block-group-footer">
          <div className="task-new-list-actions">
            {hasCheckpointDrift && (
              <button
                type="button"
                className="btn btn-ghost btn-sm task-new-revert"
                disabled={busy}
                title="Restore this plan's default blocks"
                onClick={() => onRevertToCheckpoint()}
              >
                <RevertIcon />
                Revert
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm task-new-commit"
              onClick={onOpenCommit}
              disabled={busy || (!isUpdate && tasks.length === 0)}
            >
              {commitLabel}
              <CalendarIcon />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function Modal({
  title,
  onClose,
  children,
  dialogClassName,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  dialogClassName?: string
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={['modal-dialog', dialogClassName].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

function TaskBlockMenu({
  task,
  showAddToLibrary,
  onEdit,
  onAddNote,
  onAddToLibrary,
  onRemove,
  onOpen,
  suppressClickRef,
}: {
  task: Task
  showAddToLibrary: boolean
  onEdit: () => void
  onAddNote: () => void
  onAddToLibrary: () => void
  onRemove: () => void
  onOpen?: () => void
  suppressClickRef: { current: boolean }
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menu = useFixedMenu({
    open: menuOpen,
    align: 'end',
    onClose: () => setMenuOpen(false),
  })
  const label = task.title.trim() || 'Untitled'

  return (
    <div className="task-new-menu" ref={menuRef}>
      <button
        ref={menu.triggerRef}
        type="button"
        className="btn btn-text btn-icon task-new-menu-btn"
        aria-label={`${label} options`}
        aria-expanded={menuOpen}
        aria-haspopup="true"
        title="Block options"
        onClick={() => {
          if (consumeReorderClickSuppression(suppressClickRef)) return
          setMenuOpen((open) => {
            const next = !open
            if (next) onOpen?.()
            return next
          })
        }}
      >
        ···
      </button>
      <FixedMenuPortal
        open={menuOpen}
        dropdownRef={menu.dropdownRef}
        style={menu.style}
        className="task-new-menu-dropdown"
      >
        <button
          type="button"
          role="menuitem"
          className="calendar-menu-item"
          onClick={() => {
            setMenuOpen(false)
            onEdit()
          }}
        >
          Edit
        </button>
        <button
          type="button"
          role="menuitem"
          className="calendar-menu-item"
          onClick={() => {
            setMenuOpen(false)
            onAddNote()
          }}
        >
          {optionalNote(task.note) ? 'Edit note' : 'Add note'}
        </button>
        {showAddToLibrary && (
          <button
            type="button"
            role="menuitem"
            className="calendar-menu-item"
            onClick={() => {
              setMenuOpen(false)
              onAddToLibrary()
            }}
          >
            Add to library
          </button>
        )}
        <div className="calendar-menu-sep" role="separator" />
        <button
          type="button"
          role="menuitem"
          className="calendar-menu-item"
          onClick={() => {
            setMenuOpen(false)
            onRemove()
          }}
        >
          Delete
        </button>
      </FixedMenuPortal>
    </div>
  )
}

function CalendarSyncedIcon({ title }: { title: string }) {
  return (
    <span className="task-synced-icon task-synced-icon-warn" title={title} aria-label={title}>
      <CalendarIcon />
    </span>
  )
}

function TaskSyncedCheckIcon({ title }: { title: string }) {
  return (
    <span
      className="task-synced-icon task-synced-icon-match"
      title={title}
      aria-label={title}
    >
      <CheckIcon />
    </span>
  )
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M3 9H21M17 13.0014L7 13M10.3333 17.0005L7 17M7 3V5M17 3V5M6.2 21H17.8C18.9201 21 19.4802 21 19.908 20.782C20.2843 20.5903 20.5903 20.2843 20.782 19.908C21 19.4802 21 18.9201 21 17.8V8.2C21 7.07989 21 6.51984 20.782 6.09202C20.5903 5.71569 20.2843 5.40973 19.908 5.21799C19.4802 5 18.9201 5 17.8 5H6.2C5.0799 5 4.51984 5 4.09202 5.21799C3.71569 5.40973 3.40973 5.71569 3.21799 6.09202C3 6.51984 3 7.07989 3 8.2V17.8C3 18.9201 3 19.4802 3.21799 19.908C3.40973 20.2843 3.71569 20.5903 4.09202 20.782C4.51984 21 5.07989 21 6.2 21Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function RevertIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1 4v6h6" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  )
}
