import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import type { GoogleCalendar } from '../lib/calendarApi'
import type {
  BlockGroup,
  BlockLibrary,
  SavedTaskList,
  StackAnchor,
  Task,
} from '../lib/tasks'
import {
  blockLibraryKey,
  DEFAULT_GROUP_COLOR,
  fromLocalTimeValue,
  isGroupEnabled,
  isTaskEmpty,
  localDateKey,
  resolveSavedBlocksFromKeys,
  resolveStack,
  tasksFromSavedList,
  tasksMatchCheckpoint,
  toLocalTimeValue,
} from '../lib/tasks'
import {
  hasPushedGroupOnDay,
  hasPushedTaskOnDay,
  isPushUnchanged,
  isTaskPushUnchanged,
  stackPushFingerprint,
  type PushedEvent,
  type PushSnapshot,
} from '../lib/pushedEvents'
import { SettingsMenu } from './SettingsMenu'
import { TaskFieldsForm } from './TaskFieldsForm'

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

const NEW_EDIT_ID = '__new__'
const DRAG_ACTIVATE_PX = 5
const ANCHOR_SCRUB_PX = 25
const ANCHOR_SCRUB_ACTIVATE_PX = 8

type AnchorField = 'hour' | 'minute'
type ModalKind = 'save' | 'restore' | 'commit' | 'name'

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
  onReplaceTasks: (groupId: string, tasks: Task[]) => void
  onDeleteGroup: (groupId: string) => void
  onDuplicateGroup: (groupId: string) => void
  onSaveCheckpoint: (groupId: string) => void
  onRevertToCheckpoint: (groupId: string) => void
  onAddGroup: () => void
  onSetGroupEnabled: (groupId: string, enabled: boolean) => void
  onSetGroupName: (groupId: string, name: string) => void
  onSetGroupColor: (groupId: string, color: string | undefined) => void
  onCommit: (groupId: string, calendarId: string) => Promise<boolean>
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
  busy?: boolean
  signedIn?: boolean
  onSignIn?: () => void
  onSignOut?: () => void
  /** Cross-device data — owned and synced by the caller (see useUserData). */
  savedLists: SavedTaskList[]
  targetCalendarId: string
  onSaveList: (name: string, tasks: Task[], replaceId?: string) => SavedTaskList
  onDeleteList: (id: string) => void
  onTargetCalendarChange: (id: string) => void
  pushedEvents: PushedEvent[]
  pushSnapshots: PushSnapshot[]
  blockLibrary: BlockLibrary
  onReplaceBlockLibrary: (library: BlockLibrary) => void
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
  onReplaceTasks,
  onDeleteGroup,
  onDuplicateGroup,
  onSaveCheckpoint,
  onRevertToCheckpoint,
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
  signedIn,
  onSignIn,
  onSignOut,
  savedLists,
  targetCalendarId,
  onSaveList,
  onDeleteList,
  onTargetCalendarChange,
  pushedEvents,
  pushSnapshots,
  blockLibrary,
  onReplaceBlockLibrary,
}: TaskSidebarProps) {
  const [saveName, setSaveName] = useState('')
  const [groupNameInput, setGroupNameInput] = useState('')
  const [selectedSavedId, setSelectedSavedId] = useState('')
  const [modal, setModal] = useState<ModalKind | null>(null)
  const [modalGroupId, setModalGroupId] = useState<string | null>(null)
  const [addingGroupId, setAddingGroupId] = useState<string | null>(null)

  // Keep the restore-modal selection valid as saved lists change (locally
  // or from a remote sync pull) — pick a fallback if the selected one is gone.
  useEffect(() => {
    if (selectedSavedId && !savedLists.some((l) => l.id === selectedSavedId)) {
      setSelectedSavedId(savedLists[0]?.id ?? '')
    } else if (!selectedSavedId && savedLists[0]) {
      setSelectedSavedId(savedLists[0].id)
    }
  }, [savedLists, selectedSavedId])

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
  const selectedCommitId = useMemo(() => {
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

  useEffect(() => {
    if (!editingId || editingId === NEW_EDIT_ID) return
    if (!groups.some((g) => g.tasks.some((t) => t.id === editingId))) {
      onEditingIdChange(null)
    }
  }, [editingId, groups, onEditingIdChange])

  function openModal(kind: ModalKind, groupId: string) {
    setModalGroupId(groupId)
    if (kind === 'name') {
      const group = groups.find((g) => g.id === groupId)
      setGroupNameInput(group?.name ?? '')
    }
    setModal(kind)
  }

  function closeModal() {
    setModal(null)
    setModalGroupId(null)
  }

  async function handleCommit() {
    if (!selectedCommitId || !modalGroupId) return
    const ok = await onCommit(modalGroupId, selectedCommitId)
    if (ok) closeModal()
  }

  function handleSaveList(e: React.FormEvent) {
    e.preventDefault()
    if (!modalGroup || modalGroup.tasks.length === 0) return
    const saved = onSaveList(saveName || 'Morning', modalGroup.tasks)
    setSaveName(saved.name)
    setSelectedSavedId(saved.id)
    closeModal()
  }

  function handleLoadList() {
    if (!modalGroupId) return
    const list =
      savedLists.find((l) => l.id === selectedSavedId) || savedLists[0]
    if (!list) return
    onReplaceTasks(modalGroupId, tasksFromSavedList(list))
    setSaveName(list.name)
    setSelectedSavedId(list.id)
    closeModal()
  }

  function handleDeleteList() {
    const id = selectedSavedId || savedLists[0]?.id
    if (!id) return
    onDeleteList(id)
  }

  function handleNameGroup(e: React.FormEvent) {
    e.preventDefault()
    if (!modalGroupId) return
    onSetGroupName(modalGroupId, groupNameInput)
    closeModal()
  }

  const modalResolved = modalGroup
    ? resolveStack(modalGroup.tasks, modalGroup.anchor)
    : []
  const modalDayKey = modalGroup ? localDateKey(modalGroup.anchor.at) : ''
  const modalIsUpdate =
    Boolean(modalGroupId) &&
    hasPushedGroupOnDay(pushedEvents, modalGroupId || '', modalDayKey)
  const modalPushUnchanged =
    modalIsUpdate &&
    modalGroup != null &&
    isPushUnchanged(
      pushSnapshots,
      selectedCommitId,
      modalGroup.id,
      modalDayKey,
      stackPushFingerprint(
        modalGroup.anchor,
        modalResolved.filter((task) => !isTaskEmpty(task)),
      ),
    )

  return (
    <aside className="task-sidebar">
      <div className="task-list-header">
        <div className="task-list-brand">
          <span className="brand-mark brand-mark-sm" aria-hidden />
          <h3>Timeblock</h3>
        </div>
        <div className="task-list-meta">
          <SettingsMenu
            busy={busy}
            signedIn={signedIn}
            onSignIn={onSignIn}
            onSignOut={onSignOut}
            blockLibrary={blockLibrary}
            onReplaceBlockLibrary={onReplaceBlockLibrary}
          />
        </div>
      </div>

      <div className="block-groups">
        {groups.map((group) => (
          <BlockGroupPanel
            key={group.id}
            group={group}
            collapsedLabel={group.name?.trim() || unnamedGroupLabels.get(group.id) || 'Unnamed'}
            canDeleteGroup={canDeleteGroup}
            busy={busy}
            pushedEvents={pushedEvents}
            pushSnapshots={pushSnapshots}
            selectedCommitId={selectedCommitId}
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
            onSaveCheckpoint={() => onSaveCheckpoint(group.id)}
            onRevertToCheckpoint={() => onRevertToCheckpoint(group.id)}
            onSetGroupEnabled={(enabled) => onSetGroupEnabled(group.id, enabled)}
            onOpenSave={() => openModal('save', group.id)}
            onOpenRestore={() => openModal('restore', group.id)}
            onOpenCommit={() => openModal('commit', group.id)}
            onDeleteFromCalendar={() => onDeleteFromCalendar(group.id)}
            onTaskEditPreview={onTaskEditPreview}
            onOpenName={() => openModal('name', group.id)}
            onSetGroupColor={(color) => onSetGroupColor(group.id, color)}
            blockLibrary={blockLibrary}
            onAddFromLibrary={(inputs) => onAddBlocks(group.id, inputs)}
          />
        ))}
        <button
          type="button"
          className="task-new-group"
          onClick={onAddGroup}
          disabled={busy}
        >
          New group +
        </button>
      </div>

      {modal === 'save' && modalGroup && (
        <Modal title="Save block list" onClose={closeModal}>
          <form className="modal-form" onSubmit={handleSaveList}>
            <label>
              <span>Name</span>
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
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
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={busy || modalGroup.tasks.length === 0}
              >
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === 'restore' && (
        <Modal title="Restore block list" onClose={closeModal}>
          <div className="modal-form">
            {savedLists.length === 0 ? (
              <p className="muted">No saved lists yet.</p>
            ) : (
              <label>
                <span>Saved list</span>
                <select
                  value={selectedSavedId || savedLists[0]?.id || ''}
                  onChange={(e) => setSelectedSavedId(e.target.value)}
                  autoFocus
                >
                  {savedLists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name} ({list.tasks.length})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleDeleteList}
                disabled={busy || savedLists.length === 0}
              >
                Delete
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleLoadList}
                disabled={busy || savedLists.length === 0}
              >
                Restore
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'commit' && modalGroup && (
        <Modal
          title={modalIsUpdate ? 'Update calendar' : 'Add to calendar'}
          onClose={closeModal}
        >
          <div className="modal-form">
            <label>
              <span>Target calendar</span>
              <select
                value={selectedCommitId}
                onChange={(e) => onTargetCalendarChange(e.target.value)}
                disabled={!writableCalendars.length || busy}
              >
                {writableCalendars.length === 0 ? (
                  <option value="">Sign in to choose a calendar</option>
                ) : (
                  writableCalendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.summary}
                    </option>
                  ))
                )}
              </select>
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={closeModal}
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
                  !selectedCommitId ||
                  modalPushUnchanged
                }
                title={
                  modalPushUnchanged
                    ? 'Calendar already matches this list'
                    : undefined
                }
              >
                {busy
                  ? modalIsUpdate
                    ? 'Updating…'
                    : 'Adding…'
                  : modalIsUpdate
                    ? 'Update'
                    : 'Add'}
                {!busy && <CalendarIcon />}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'name' && modalGroup && (
        <Modal title="Name group" onClose={closeModal}>
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

    </aside>
  )
}

type BlockGroupPanelProps = {
  group: BlockGroup
  collapsedLabel: string
  canDeleteGroup: boolean
  busy?: boolean
  pushedEvents: PushedEvent[]
  pushSnapshots: PushSnapshot[]
  selectedCommitId: string
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
  onSaveCheckpoint: () => void
  onRevertToCheckpoint: () => void
  onSetGroupEnabled: (enabled: boolean) => void
  onOpenSave: () => void
  onOpenRestore: () => void
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
      <span>Set color</span>
      <input
        type="color"
        value={value}
        disabled={disabled}
        aria-label="Group color"
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

function BlockGroupPanel({
  group,
  collapsedLabel,
  canDeleteGroup,
  busy,
  pushedEvents,
  pushSnapshots,
  selectedCommitId,
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
  onSaveCheckpoint,
  onRevertToCheckpoint,
  onSetGroupEnabled,
  onOpenSave,
  onOpenRestore,
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
  const [collapsedMenuOpen, setCollapsedMenuOpen] = useState(false)

  const listRef = useRef<HTMLUListElement>(null)
  const listMenuRef = useRef<HTMLDivElement>(null)
  const libraryMenuRef = useRef<HTMLDivElement>(null)
  const libraryTriggerRef = useRef<HTMLButtonElement>(null)
  const libraryDropdownRef = useRef<HTMLDivElement>(null)
  const collapsedMenuRef = useRef<HTMLDivElement>(null)
  const dropLineIndexRef = useRef<number | null>(null)
  const suppressClickRef = useRef(false)
  const tasksLengthRef = useRef(tasks.length)
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor

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
      if (listMenuRef.current && !listMenuRef.current.contains(target)) {
        setListMenuOpen(false)
      }
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

  useEffect(() => {
    if (!collapsedMenuOpen) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (collapsedMenuRef.current && !collapsedMenuRef.current.contains(target)) {
        setCollapsedMenuOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setCollapsedMenuOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [collapsedMenuOpen])

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
  const stackSummary =
    resolved.length === 0
      ? null
      : `${timeFmt.format(resolved[0]!.start)} – ${timeFmt.format(resolved[resolved.length - 1]!.end)}`
  const dayKey = localDateKey(anchor.at)
  const onCalendar = hasPushedGroupOnDay(pushedEvents, group.id, dayKey)
  const isUpdate = onCalendar
  const pushUnchanged =
    isUpdate &&
    isPushUnchanged(
      pushSnapshots,
      selectedCommitId,
      group.id,
      dayKey,
      stackPushFingerprint(
        anchor,
        resolved.filter((task) => !isTaskEmpty(task)),
      ),
    )
  const hasCheckpointDrift = Boolean(
    group.checkpoint && !tasksMatchCheckpoint(tasks, group.checkpoint),
  )
  function beginAnchorScrub(e: React.PointerEvent<HTMLInputElement>) {
    if (e.button !== 0) return
    const input = e.currentTarget
    const startY = e.clientY
    const startX = e.clientX
    const pointerId = e.pointerId
    let active = false
    let lastTick = 0
    let field: AnchorField = 'minute'

    function currentIso(): string {
      if (input.value) {
        const parsed = fromLocalTimeValue(input.value, anchorRef.current.at)
        if (!Number.isNaN(new Date(parsed).getTime())) return parsed
      }
      return anchorRef.current.at
    }

    let originIso = ''

    function isoForTick(tick: number): string {
      if (tick === 0 || !originIso) return originIso || currentIso()
      const d = new Date(originIso)
      if (Number.isNaN(d.getTime())) return originIso
      if (field === 'hour') {
        d.setHours(d.getHours() + tick)
      } else {
        const m = d.getMinutes()
        const next =
          tick > 0
            ? Math.floor(m / 5) * 5 + tick * 5
            : Math.ceil(m / 5) * 5 + tick * 5
        d.setMinutes(next)
      }
      return d.toISOString()
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
        originIso = currentIso()
        document.body.classList.add('is-datetime-scrubbing')
        input.blur()
        try {
          input.setPointerCapture(pointerId)
        } catch {
          /* ignore */
        }
      }
      ev.preventDefault()
      const tick = Math.trunc(-dy / ANCHOR_SCRUB_PX)
      if (tick === lastTick) return
      lastTick = tick
      onAnchorChange({ ...anchorRef.current, at: isoForTick(tick) })
    }

    function cleanup() {
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

  if (!enabled) {
    return (
      <section className="block-group block-group-collapsed block-group-disabled">
        <div className="block-group-collapsed-row">
          <PowerToggle
            enabled={enabled}
            disabled={busy}
            onChange={handlePowerChange}
          />
          <button
            type="button"
            className="block-group-collapsed-toggle"
            onClick={() => onSetGroupEnabled(true)}
            disabled={busy}
            aria-expanded={false}
          >
            <span className="block-group-collapsed-title">{collapsedLabel}</span>
          </button>
          <div className="task-new-menu block-group-collapsed-menu" ref={collapsedMenuRef}>
            <button
              type="button"
              className="btn btn-text btn-icon task-new-menu-btn"
              aria-label="Collapsed group options"
              aria-expanded={collapsedMenuOpen}
              aria-haspopup="true"
              disabled={busy}
              onClick={() => setCollapsedMenuOpen((open) => !open)}
            >
              ···
            </button>
            {collapsedMenuOpen && (
              <div className="task-new-menu-dropdown" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="calendar-menu-item"
                  disabled={busy}
                  onClick={() => {
                    setCollapsedMenuOpen(false)
                    onOpenName()
                  }}
                >
                  Name group
                </button>
                <GroupColorMenuItem
                  value={colorPickerValue}
                  disabled={busy}
                  onChange={handleColorChange}
                />
              </div>
            )}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="block-group">
      <div className="stack-anchor">
        <div className="stack-anchor-row">
          <PowerToggle
            enabled={enabled}
            disabled={busy}
            onChange={handlePowerChange}
          />
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
                onAnchorChange({
                  ...anchor,
                  kind: anchor.kind === 'start' ? 'end' : 'start',
                })
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
              {anchor.kind === 'end' ? 'List ends at' : 'List starts at'}
            </span>
            <input
              type="time"
              step={300}
              value={toLocalTimeValue(anchor.at)}
              onChange={(e) => {
                if (!e.target.value) return
                onAnchorChange({
                  ...anchor,
                  at: fromLocalTimeValue(e.target.value, anchor.at),
                })
              }}
              onPointerDown={beginAnchorScrub}
            />
          </label>
          {stackSummary && (
            <span className="task-range muted">{stackSummary}</span>
          )}
        </div>
      </div>

      <ul className="task-list" ref={listRef}>
        {tasks.map((task, index) => {
          const editing = editingId === task.id
          const resolvedTask = resolved.find((r) => r.id === task.id)
          const pushed =
            !isTaskEmpty(task) &&
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
                      {task.title}
                      <span className="muted task-duration">
                        {' '}
                        · {task.durationMinutes} min
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
                    New block +
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
                                        {block.durationMinutes} min
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
                  Custom +
                </button>
              </div>
              <div className="task-new-list-actions">
                <div className="task-new-menu" ref={listMenuRef}>
                  <button
                    type="button"
                    className="btn btn-text btn-icon task-new-menu-btn"
                    aria-label="Block group options"
                    aria-expanded={listMenuOpen}
                    aria-haspopup="true"
                    disabled={busy}
                    onClick={() => setListMenuOpen((open) => !open)}
                  >
                    ···
                  </button>
                  {listMenuOpen && (
                    <div className="task-new-menu-dropdown" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        className="calendar-menu-item calendar-menu-item-struck"
                        disabled={busy || tasks.length === 0}
                        onClick={() => {
                          setListMenuOpen(false)
                          onOpenSave()
                        }}
                      >
                        Save blocks
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="calendar-menu-item calendar-menu-item-struck"
                        disabled={busy}
                        onClick={() => {
                          setListMenuOpen(false)
                          onOpenRestore()
                        }}
                      >
                        Restore blocks
                      </button>
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
                        Name group
                      </button>
                      <GroupColorMenuItem
                        value={colorPickerValue}
                        disabled={busy}
                        onChange={handleColorChange}
                      />
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
                        Duplicate group
                      </button>
                      <div className="calendar-menu-sep" role="separator" />
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
                        {group.checkpoint ? 'Update default blocks' : 'Save as default'}
                      </button>
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
                        Delete block group
                      </button>
                    </div>
                  )}
                </div>
                {hasCheckpointDrift && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm task-new-revert"
                    disabled={busy}
                    title="Restore this group's default blocks"
                    onClick={() => onRevertToCheckpoint()}
                  >
                    <RevertIcon />
                    Revert
                  </button>
                )}
                <button
                  type="button"
                  className={[
                    'btn btn-primary btn-sm task-new-commit',
                    pushUnchanged ? 'is-appearance-disabled' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={onOpenCommit}
                  disabled={busy || (!isUpdate && tasks.length === 0)}
                  title={
                    pushUnchanged
                      ? 'Already up to date — open to change calendar'
                      : undefined
                  }
                >
                  {isUpdate ? 'Update' : 'Add'}
                  <CalendarIcon />
                </button>
              </div>
            </div>
          )}
        </li>
      </ul>
    </section>
  )
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
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
        className="modal-dialog"
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

function PowerToggle({
  enabled,
  disabled,
  onChange,
}: {
  enabled: boolean
  disabled?: boolean
  onChange: (enabled: boolean) => void
}) {
  return (
    <button
      type="button"
      className={['power-toggle', enabled ? 'is-on' : ''].filter(Boolean).join(' ')}
      aria-label={enabled ? 'Turn off group' : 'Turn on group'}
      aria-pressed={enabled}
      title={enabled ? 'Turn off and collapse group' : 'Turn on and expand group'}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
    >
      <PowerIcon />
    </button>
  )
}

function PowerIcon() {
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
      <path d="M12 2v10" />
      <path d="M18.4 6.6a9 9 0 1 1-12.77 0" />
    </svg>
  )
}

function EditIcon() {
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function TrashIcon() {
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
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}
