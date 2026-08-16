import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import type { GoogleCalendar, SyncProgress } from '../lib/calendarApi'
import type {
  BlockGroup,
  BlockLibrary,
  StackAnchor,
  Task,
} from '../lib/tasks'
import {
  blockLibraryKey,
  DEFAULT_GROUP_COLOR,
  formatDurationMinutes,
  fromLocalTimeValue,
  getStackEndStatus,
  groupSidebarAccentColor,
  isGroupEnabled,
  isGroupExecutableNow,
  isTaskDelay,
  isTaskDisabled,
  isTaskEmpty,
  localDateKey,
  groupMatchesCheckpoint,
  resolveSavedBlocksFromKeys,
  resolveStack,
  stackDurationMinutes,
  stepLocalTime,
  toggleAnchorPreservingStack,
  toLocalTimeValue,
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
import { SettingsMenu } from './SettingsMenu'
import { TaskFieldsForm } from './TaskFieldsForm'
import {
  BlockIcon,
  DelayedIcon,
  DisableBlockIcon,
  EditIcon,
  FinishedCheckIcon,
  LibraryIcon,
  PendingIcon,
  TrashIcon,
} from './icons'
import type { NoticeOptions } from '../lib/notice'
import type { SessionDiagnostics } from '../lib/google'
import type { ArchivedPlan, PlanArchive } from '../lib/planArchive'
import { ArchivedPlansModal } from './ArchivedPlansModal'

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

const NEW_EDIT_ID = '__new__'
const DRAG_ACTIVATE_PX = 5
const ANCHOR_SCRUB_PX = 25
const ANCHOR_SCRUB_ACTIVATE_PX = 8

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
  onAdd: (groupId: string, task: Omit<Task, 'id'>) => void
  onAddBlocks: (groupId: string, tasks: Omit<Task, 'id'>[]) => void
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
  onCommit: (groupId: string, calendarIds: string[]) => Promise<boolean>
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
  onReplacePlanArchive: (archive: PlanArchive) => void
  onAddArchivedToHome: (plan: ArchivedPlan) => string
  onShowNotice?: (text: string, options?: NoticeOptions) => void
  onClearNotice?: () => void
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
  onReplacePlanArchive,
  onAddArchivedToHome,
  onShowNotice,
  onClearNotice,
}: TaskSidebarProps) {
  const [groupNameInput, setGroupNameInput] = useState('')
  const [modal, setModal] = useState<ModalKind | null>(null)
  const [modalGroupId, setModalGroupId] = useState<string | null>(null)
  const [addingGroupId, setAddingGroupId] = useState<string | null>(null)
  const [archivedPlansOpen, setArchivedPlansOpen] = useState(false)
  const [scrollToGroupId, setScrollToGroupId] = useState<string | null>(null)
  const blockGroupsRef = useRef<HTMLDivElement>(null)
  const [selectedCommitIds, setSelectedCommitIds] = useState<string[]>([])
  /** Snapshot of calendar order when the commit modal opens (selected first). */
  const [commitCalendarOrder, setCommitCalendarOrder] = useState<string[]>([])

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
    }
    setModal(kind)
  }

  function closeModal() {
    setModal(null)
    setModalGroupId(null)
    setCommitCalendarOrder([])
  }

  async function handleCommit() {
    if (selectedCommitIds.length === 0 || !modalGroupId) return
    const ok = await onCommit(modalGroupId, selectedCommitIds)
    if (ok) {
      if (selectedCommitIds[0]) {
        onTargetCalendarChange(selectedCommitIds[0])
      }
      closeModal()
    }
  }

  function handleNameGroup(e: React.FormEvent) {
    e.preventDefault()
    if (!modalGroupId) return
    onSetGroupName(modalGroupId, groupNameInput)
    closeModal()
  }

  const modalDayKey = modalGroup ? localDateKey(modalGroup.anchor.at) : ''
  const modalIsUpdate =
    Boolean(modalGroupId) &&
    hasPushedGroupOnDay(pushedEvents, modalGroupId || '', modalDayKey)
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
              onOpenArchivedPlans={() => setArchivedPlansOpen(true)}
              onShowNotice={onShowNotice}
              onClearNotice={onClearNotice}
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
            onAdd={(task) => {
              onAdd(group.id, task)
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
            onAddFromLibrary={(inputs) => onAddBlocks(group.id, inputs)}
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
              onClick={() => setArchivedPlansOpen(true)}
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
                commitCalendars.map((calendar) => (
                  <label key={calendar.id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={selectedCommitIds.includes(calendar.id)}
                      disabled={busy}
                      onChange={(e) => {
                        setSelectedCommitIds((current) =>
                          e.target.checked
                            ? [...current, calendar.id]
                            : current.filter((id) => id !== calendar.id),
                        )
                      }}
                    />
                    <span>{calendar.summary}</span>
                  </label>
                ))
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
                  selectedCommitIds.length === 0
                }
              >
                {busy
                  ? commitProgress?.label ??
                    (modalIsUpdate ? 'Updating…' : 'Adding…')
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
          onChange={onReplacePlanArchive}
          onAddToHome={handleAddFromArchive}
          onClose={() => setArchivedPlansOpen(false)}
          onShowNotice={onShowNotice}
          onClearNotice={onClearNotice}
        />
      )}

    </aside>
  )
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
  adding: boolean
  onEditingIdChange: (id: string | null) => void
  onStartAdd: () => void
  onCancelAdd: () => void
  onAdd: (task: Omit<Task, 'id'>) => void
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
  onAddFromLibrary: (inputs: Omit<Task, 'id'>[]) => void
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
}: BlockGroupPanelProps) {
  const { tasks, anchor } = group
  const enabled = isGroupEnabled(group)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropLineIndex, setDropLineIndex] = useState<number | null>(null)
  const [listMenuOpen, setListMenuOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [librarySelection, setLibrarySelection] = useState<string[]>([])
  const [libraryDropdownStyle, setLibraryDropdownStyle] =
    useState<CSSProperties>({})

  const listRef = useRef<HTMLUListElement>(null)
  const listMenuRef = useRef<HTMLDivElement>(null)
  const listMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const listMenuDropdownRef = useRef<HTMLDivElement>(null)
  const libraryMenuRef = useRef<HTMLDivElement>(null)
  const libraryTriggerRef = useRef<HTMLButtonElement>(null)
  const libraryDropdownRef = useRef<HTMLDivElement>(null)
  const dropLineIndexRef = useRef<number | null>(null)
  const suppressClickRef = useRef(false)
  const timePointerActiveRef = useRef(false)
  const tasksLengthRef = useRef(tasks.length)
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor
  const intendedEndAtRef = useRef(group.intendedEndAt)
  intendedEndAtRef.current = group.intendedEndAt
  const [listMenuDropdownStyle, setListMenuDropdownStyle] =
    useState<CSSProperties>({})
  const [nowMs, setNowMs] = useState(() => Date.now())

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
    if (!editingId || editingId === NEW_EDIT_ID) return
    if (!tasks.some((t) => t.id === editingId)) return
    const card = listRef.current?.querySelector(
      `[data-task-id="${CSS.escape(editingId)}"]`,
    )
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [editingId, tasks])

  useEffect(() => {
    if (!listMenuOpen) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (
        listMenuRef.current?.contains(target) ||
        listMenuDropdownRef.current?.contains(target)
      ) {
        return
      }
      setListMenuOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setListMenuOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [listMenuOpen])

  useEffect(() => {
    if (!libraryOpen) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (
        libraryMenuRef.current?.contains(target) ||
        libraryDropdownRef.current?.contains(target)
      ) {
        return
      }
      setLibraryOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setLibraryOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [libraryOpen])

  useLayoutEffect(() => {
    if (!libraryOpen) {
      setLibraryDropdownStyle({})
      return
    }

    function repositionLibraryDropdown() {
      const trigger = libraryTriggerRef.current
      const dropdown = libraryDropdownRef.current
      if (!trigger || !dropdown) return

      const gap = 6
      const pad = 8
      const triggerRect = trigger.getBoundingClientRect()
      const width = Math.min(
        288,
        Math.max(triggerRect.width, 224),
        window.innerWidth - pad * 2,
      )
      const dropdownHeight = dropdown.scrollHeight
      const spaceBelow = window.innerHeight - triggerRect.bottom - pad
      const spaceAbove = triggerRect.top - pad
      const openDown = spaceBelow >= spaceAbove
      const available = (openDown ? spaceBelow : spaceAbove) - gap
      const viewportCap = window.innerHeight * 0.75 - pad * 2
      const maxHeight = Math.max(160, Math.min(available, viewportCap))
      let top = openDown
        ? triggerRect.bottom + gap
        : triggerRect.top - Math.min(dropdownHeight, maxHeight) - gap
      top = Math.max(pad, Math.min(top, window.innerHeight - pad - maxHeight))
      let left = triggerRect.left
      left = Math.max(pad, Math.min(left, window.innerWidth - width - pad))

      setLibraryDropdownStyle({
        position: 'fixed',
        top,
        left,
        width,
        maxHeight,
        zIndex: 75,
        bottom: 'auto',
        right: 'auto',
      })
    }

    repositionLibraryDropdown()
    const sidebar = libraryMenuRef.current?.closest('.task-sidebar')
    window.addEventListener('resize', repositionLibraryDropdown)
    sidebar?.addEventListener('scroll', repositionLibraryDropdown, {
      passive: true,
    })
    return () => {
      window.removeEventListener('resize', repositionLibraryDropdown)
      sidebar?.removeEventListener('scroll', repositionLibraryDropdown)
    }
  }, [libraryOpen, librarySelection, blockLibrary])

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
      })),
    )
    setLibrarySelection([])
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
  const stackSummary =
    activeResolved.length === 0
      ? null
      : `${timeFmt.format(activeResolved[0]!.start)} – ${timeFmt.format(activeResolved[activeResolved.length - 1]!.end)}`
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

  useLayoutEffect(() => {
    if (!listMenuOpen) {
      setListMenuDropdownStyle({})
      return
    }

    function repositionListMenuDropdown() {
      const trigger = listMenuTriggerRef.current
      const dropdown = listMenuDropdownRef.current
      if (!trigger || !dropdown) return

      const gap = 6
      const pad = 8
      const triggerRect = trigger.getBoundingClientRect()
      const dropdownHeight = dropdown.offsetHeight
      const dropdownWidth = dropdown.offsetWidth
      const spaceBelow = window.innerHeight - triggerRect.bottom - pad
      const spaceAbove = triggerRect.top - pad
      const openUp =
        spaceAbove >= dropdownHeight + gap &&
        (spaceAbove >= spaceBelow || spaceBelow < dropdownHeight + gap)
      let top = openUp
        ? triggerRect.top - dropdownHeight - gap
        : triggerRect.bottom + gap
      top -= 4
      top = Math.max(pad, Math.min(top, window.innerHeight - pad - dropdownHeight))
      let left = triggerRect.right - dropdownWidth
      left = Math.max(pad, Math.min(left, window.innerWidth - dropdownWidth - pad))

      setListMenuDropdownStyle({
        position: 'fixed',
        top,
        left,
        minWidth: dropdownWidth,
        zIndex: 75,
        bottom: 'auto',
        right: 'auto',
      })
    }

    repositionListMenuDropdown()
    const sidebar = listMenuRef.current?.closest('.task-sidebar')
    window.addEventListener('resize', repositionListMenuDropdown)
    sidebar?.addEventListener('scroll', repositionListMenuDropdown, {
      passive: true,
    })
    return () => {
      window.removeEventListener('resize', repositionListMenuDropdown)
      sidebar?.removeEventListener('scroll', repositionListMenuDropdown)
    }
  }, [
    listMenuOpen,
    enabled,
    canMoveGroupUp,
    canMoveGroupDown,
    showSaveCheckpoint,
    group.checkpoint,
    tasks.length,
    onCalendar,
    canDeleteGroup,
  ])

  function renderListMenuDropdown() {
    if (!listMenuOpen) return null

    return createPortal(
      <div
        ref={listMenuDropdownRef}
        className="task-new-menu-dropdown task-new-menu-dropdown-fixed"
        style={listMenuDropdownStyle}
        role="menu"
      >
        {enabled && showSaveCheckpoint && (
          <>
            <button
              type="button"
              role="menuitem"
              className="calendar-menu-item"
              disabled={busy || tasks.length === 0}
              onClick={() => {
                setListMenuOpen(false)
                onSaveCheckpoint()
              }}
            >
              Update default
            </button>
            <div className="calendar-menu-sep" role="separator" />
          </>
        )}
        <button
          type="button"
          role="menuitem"
          className="calendar-menu-item"
          disabled={busy}
          onClick={() => {
            setListMenuOpen(false)
            onOpenName()
          }}
        >
          Rename
        </button>
        {enabled && (
          <GroupColorMenuItem
            value={colorPickerValue}
            disabled={busy}
            onChange={handleColorChange}
          />
        )}
        {(canMoveGroupUp || canMoveGroupDown) && (
          <>
            <div className="calendar-menu-sep" role="separator" />
            {canMoveGroupUp && (
              <button
                type="button"
                role="menuitem"
                className="calendar-menu-item"
                disabled={busy}
                onClick={() => {
                  setListMenuOpen(false)
                  onMoveGroupUp()
                }}
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
                onClick={() => {
                  setListMenuOpen(false)
                  onMoveGroupDown()
                }}
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
          onClick={() => {
            setListMenuOpen(false)
            onDuplicateGroup()
          }}
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
              onClick={() => {
                setListMenuOpen(false)
                onArchiveGroup()
              }}
            >
              Archive
            </button>
            <button
              type="button"
              role="menuitem"
              className="calendar-menu-item"
              disabled={busy || !canDeleteGroup}
              onClick={() => {
                setListMenuOpen(false)
                onDeleteGroup()
              }}
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
              onClick={() => {
                setListMenuOpen(false)
                void onDeleteFromCalendar()
              }}
            >
              Delete from calendar
            </button>
          </>
        )}
      </div>,
      document.body,
    )
  }

  function renderListMenu() {
    return (
      <div className="task-new-menu" ref={listMenuRef}>
        <button
          type="button"
          ref={listMenuTriggerRef}
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
      return stepLocalTime(originIso, field, tick)
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
    onIsoChange(stepLocalTime(baseIso, field, steps))
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

  function beginTaskDrag(
    e: React.PointerEvent<HTMLElement>,
    index: number,
  ) {
    if (e.button !== 0 && e.pointerType === 'mouse') return

    const handle = e.currentTarget
    const pointerId = e.pointerId
    const startX = e.clientX
    const startY = e.clientY
    let active = false
    let cancelled = false

    // Immediate drag on touch/mouse — only from the title/duration handle.
    try {
      handle.setPointerCapture(pointerId)
    } catch {
      /* ignore */
    }

    const endReorderSession = () => {
      document.body.classList.remove('is-task-reordering')
      setDragIndex(null)
      setDropLineIndex(null)
      dropLineIndexRef.current = null
    }

    const activate = () => {
      if (cancelled || active) return
      active = true
      dropLineIndexRef.current = index
      setDragIndex(index)
      setDropLineIndex(index)
      document.body.classList.add('is-task-reordering')
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate?.(12)
      }
    }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || cancelled) return
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      const dist = Math.hypot(dx, dy)

      if (!active) {
        if (dist < DRAG_ACTIVATE_PX) return
        activate()
      }

      ev.preventDefault()
      const nextLine = lineIndexFromY(ev.clientY)
      if (dropLineIndexRef.current !== nextLine) {
        dropLineIndexRef.current = nextLine
        setDropLineIndex(nextLine)
      }
    }

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      if (active) {
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
        const insertAt =
          dropLineIndexRef.current ?? lineIndexFromY(ev.clientY)
        handleDropAt(insertAt, index)
      }
      endReorderSession()
      cleanupListeners()
    }

    const cleanupListeners = () => {
      cancelled = true
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
      try {
        if (handle.hasPointerCapture(pointerId)) {
          handle.releasePointerCapture(pointerId)
        }
      } catch {
        /* ignore */
      }
    }

    document.addEventListener('pointermove', onMove, { passive: false })
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
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
                    step={300}
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
                        step={300}
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
                  step={300}
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
          const showLineBefore =
            dropLineIndex === index &&
            dragIndex !== null &&
            dropLineIndex !== dragIndex &&
            dropLineIndex !== dragIndex + 1

          function toggleTaskDone() {
            if (suppressClickRef.current || isTaskDelay(task)) return
            if (task.done) {
              const { done: _d, ...rest } = task
              onUpdate(rest)
            } else {
              onUpdate({ ...task, done: true })
            }
          }

          return (
            <li
              key={task.id}
              data-task-index={index}
              data-task-id={task.id}
              className={[
                'task-card',
                dragIndex === index ? 'is-dragging' : '',
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
                  submitLabel="Save"
                  busy={busy}
                  previewGroupId={group.id}
                  previewTaskId={task.id}
                  onTaskEditPreview={onTaskEditPreview}
                  onCancel={() => onEditingIdChange(null)}
                  onSubmit={(next) => {
                    const updated: Task = {
                      ...task,
                      title: next.title,
                      durationMinutes: next.durationMinutes,
                    }
                    if (next.empty) updated.empty = true
                    else delete updated.empty
                    onUpdate(updated)
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
                      if (suppressClickRef.current) return
                      onEditingIdChange(task.id)
                    }}
                  >
                    <span className="task-title">
                      {pushed &&
                        (synced ? (
                          <TaskSyncedCheckIcon title="Matches Google Calendar" />
                        ) : (
                          <CalendarSyncedIcon title="On Google Calendar — tap Update to sync changes" />
                        ))}
                      <span className="task-title-text">{task.title}</span>
                      <span className="muted task-duration">
                        · {formatDurationMinutes(task.durationMinutes)}
                      </span>
                    </span>
                  </div>
                  <div className="task-card-icons">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Edit ${task.title}`}
                      title="Edit"
                      onClick={() => {
                        if (suppressClickRef.current) return
                        onEditingIdChange(task.id)
                      }}
                    >
                      <EditIcon />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={
                        isTaskDisabled(task)
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
                        if (suppressClickRef.current || isTaskDelay(task)) return
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
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove ${task.title}`}
                      title="Remove"
                      onClick={() => {
                        if (suppressClickRef.current) return
                        onRemove(task.id)
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </>
              )}
            </li>
          )
        })}

        <li
          className={[
            'task-card',
            'task-card-new',
            adding ? 'is-editing' : '',
            dropLineIndex === tasks.length &&
            dragIndex !== null &&
            dropLineIndex !== dragIndex &&
            dropLineIndex !== dragIndex + 1
              ? 'drop-line-before'
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {adding ? (
            <TaskFieldsForm
              initialTitle=""
              initialDuration={30}
              submitLabel="Add"
              busy={busy}
              onCancel={onCancelAdd}
              onSubmit={onAdd}
            />
          ) : (
            <div className="task-new-row">
              <div className="task-new-triggers">
                <div className="task-new-menu task-new-library" ref={libraryMenuRef}>
                  <button
                    ref={libraryTriggerRef}
                    type="button"
                    className="task-new-trigger"
                    disabled={busy}
                    aria-expanded={libraryOpen}
                    aria-haspopup="listbox"
                    onClick={() => {
                      setLibraryOpen((open) => !open)
                      setListMenuOpen(false)
                    }}
                  >
                    <LibraryIcon />
                    <span className="task-new-trigger-label">Library block</span>
                  </button>
                  {libraryOpen &&
                    createPortal(
                      <div
                        ref={libraryDropdownRef}
                        className="task-new-menu-dropdown block-library-picker block-library-picker-fixed"
                        style={libraryDropdownStyle}
                        role="listbox"
                        aria-multiselectable="true"
                      >
                        <div className="block-library-picker-list">
                          {blockLibrary.categories.length === 0 ? (
                            <p className="muted block-library-picker-empty">
                              No saved blocks yet. Add some in Settings → Block
                              library.
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
                                      <span className="muted block-library-picker-duration">
                                        {formatDurationMinutes(
                                          block.durationMinutes,
                                        )}
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
                      </div>,
                      document.body,
                    )}
                </div>
                <button
                  type="button"
                  className="task-new-trigger task-new-trigger-secondary"
                  onClick={onStartAdd}
                  disabled={busy}
                >
                  <BlockIcon />
                  <span className="task-new-trigger-label">Custom</span>
                </button>
              </div>
            </div>
          )}
        </li>
      </ul>
      <div className="block-group-footer">
        <div className="task-new-list-actions">
          {mode !== 'execution' && hasCheckpointDrift && (
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
