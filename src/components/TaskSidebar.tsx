import { useEffect, useMemo, useRef, useState } from 'react'
import type { GoogleCalendar } from '../lib/calendarApi'
import type {
  BlockGroup,
  SavedTaskList,
  StackAnchor,
  Task,
} from '../lib/tasks'
import {
  deleteSavedList,
  fromLocalTimeValue,
  loadSavedLists,
  loadTargetCalendarId,
  localDateKey,
  resolveStack,
  saveTargetCalendarId,
  saveTaskList,
  tasksFromSavedList,
  toLocalTimeValue,
} from '../lib/tasks'
import {
  hasPushedGroupOnDay,
  isPushUnchanged,
  stackPushFingerprint,
} from '../lib/pushedEvents'
import { SettingsMenu } from './SettingsMenu'

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

const NEW_EDIT_ID = '__new__'
const DRAG_ACTIVATE_PX = 5
const ANCHOR_SCRUB_PX = 25
const ANCHOR_SCRUB_ACTIVATE_PX = 8

type AnchorField = 'hour' | 'minute'
type ModalKind = 'save' | 'restore' | 'commit' | 'hide'

function blockCountLabel(count: number): string {
  return count === 1 ? '1 Block' : `${count} Blocks`
}

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
  onUpdate: (groupId: string, task: Task) => void
  onRemove: (groupId: string, id: string) => void
  onReorder: (groupId: string, fromIndex: number, toIndex: number) => void
  onAnchorChange: (groupId: string, anchor: StackAnchor) => void
  onReplaceTasks: (groupId: string, tasks: Task[]) => void
  onClear: (groupId: string) => void
  onDeleteGroup: (groupId: string) => void
  onAddGroup: () => void
  onHideGroup: (groupId: string, name: string) => void
  onShowGroup: (groupId: string) => void
  onCommit: (groupId: string, calendarId: string) => Promise<boolean>
  editingId: string | null
  onEditingIdChange: (id: string | null) => void
  busy?: boolean
  signedIn?: boolean
  onSignIn?: () => void
  onSignOut?: () => void
}

export function TaskSidebar({
  groups,
  canDeleteGroup,
  writableCalendars,
  onAdd,
  onUpdate,
  onRemove,
  onReorder,
  onAnchorChange,
  onReplaceTasks,
  onClear,
  onDeleteGroup,
  onAddGroup,
  onHideGroup,
  onShowGroup,
  onCommit,
  editingId,
  onEditingIdChange,
  busy,
  signedIn,
  onSignIn,
  onSignOut,
}: TaskSidebarProps) {
  const [commitCalendarId, setCommitCalendarId] = useState(loadTargetCalendarId)
  const [savedLists, setSavedLists] = useState<SavedTaskList[]>(() =>
    loadSavedLists(),
  )
  const [saveName, setSaveName] = useState('')
  const [hideName, setHideName] = useState('')
  const [selectedSavedId, setSelectedSavedId] = useState('')
  const [modal, setModal] = useState<ModalKind | null>(null)
  const [modalGroupId, setModalGroupId] = useState<string | null>(null)
  const [pushEpoch, setPushEpoch] = useState(0)
  const [addingGroupId, setAddingGroupId] = useState<string | null>(null)

  const modalGroup = groups.find((g) => g.id === modalGroupId) ?? null
  const selectedCommitId = useMemo(() => {
    if (
      commitCalendarId &&
      writableCalendars.some((c) => c.id === commitCalendarId)
    ) {
      return commitCalendarId
    }
    return (
      writableCalendars.find((c) => c.primary)?.id ||
      writableCalendars[0]?.id ||
      ''
    )
  }, [commitCalendarId, writableCalendars])

  useEffect(() => {
    if (!editingId || editingId === NEW_EDIT_ID) return
    if (!groups.some((g) => g.tasks.some((t) => t.id === editingId))) {
      onEditingIdChange(null)
    }
  }, [editingId, groups, onEditingIdChange])

  function openModal(kind: ModalKind, groupId: string) {
    setModalGroupId(groupId)
    if (kind === 'restore') refreshSavedLists()
    if (kind === 'hide') {
      const group = groups.find((g) => g.id === groupId)
      setHideName(group?.name ?? '')
    }
    setModal(kind)
  }

  function handleHideGroup(e: React.FormEvent) {
    e.preventDefault()
    if (!modalGroupId) return
    onHideGroup(modalGroupId, hideName)
    closeModal()
  }

  function closeModal() {
    setModal(null)
    setModalGroupId(null)
  }

  function refreshSavedLists(preferId?: string) {
    const lists = loadSavedLists()
    setSavedLists(lists)
    if (preferId && lists.some((l) => l.id === preferId)) {
      setSelectedSavedId(preferId)
    } else if (
      selectedSavedId &&
      !lists.some((l) => l.id === selectedSavedId)
    ) {
      setSelectedSavedId(lists[0]?.id ?? '')
    } else if (!selectedSavedId && lists[0]) {
      setSelectedSavedId(lists[0].id)
    }
  }

  async function handleCommit() {
    if (!selectedCommitId || !modalGroupId) return
    const ok = await onCommit(modalGroupId, selectedCommitId)
    setPushEpoch((n) => n + 1)
    if (ok) closeModal()
  }

  function handleSaveList(e: React.FormEvent) {
    e.preventDefault()
    if (!modalGroup || modalGroup.tasks.length === 0) return
    const saved = saveTaskList(saveName || 'Morning', modalGroup.tasks)
    setSaveName(saved.name)
    refreshSavedLists(saved.id)
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
    deleteSavedList(id)
    refreshSavedLists()
  }

  const modalResolved = modalGroup
    ? resolveStack(modalGroup.tasks, modalGroup.anchor)
    : []
  const modalDayKey = modalGroup ? localDateKey(modalGroup.anchor.at) : ''
  const modalIsUpdate =
    pushEpoch >= 0 &&
    Boolean(modalGroupId) &&
    hasPushedGroupOnDay(modalGroupId || '', modalDayKey)
  const modalPushUnchanged =
    modalIsUpdate &&
    modalGroup != null &&
    isPushUnchanged(
      selectedCommitId,
      modalGroup.id,
      modalDayKey,
      stackPushFingerprint(modalGroup.anchor, modalResolved),
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
          />
        </div>
      </div>

      <div className="block-groups">
        {groups.map((group) => (
          <BlockGroupPanel
            key={group.id}
            group={group}
            canDeleteGroup={canDeleteGroup}
            busy={busy}
            pushEpoch={pushEpoch}
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
            onClear={() => onClear(group.id)}
            onDeleteGroup={() => onDeleteGroup(group.id)}
            onShowGroup={() => onShowGroup(group.id)}
            onOpenSave={() => openModal('save', group.id)}
            onOpenRestore={() => openModal('restore', group.id)}
            onOpenCommit={() => openModal('commit', group.id)}
            onOpenHide={() => openModal('hide', group.id)}
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

      {modal === 'hide' && modalGroup && (
        <Modal title="Hide block group" onClose={closeModal}>
          <form className="modal-form" onSubmit={handleHideGroup}>
            <label>
              <span>Name (optional)</span>
              <input
                value={hideName}
                onChange={(e) => setHideName(e.target.value)}
                placeholder="Morning stack"
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
              <button type="submit" className="btn btn-primary btn-sm">
                Hide
              </button>
            </div>
          </form>
        </Modal>
      )}

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
                onChange={(e) => {
                  setCommitCalendarId(e.target.value)
                  saveTargetCalendarId(e.target.value)
                }}
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

    </aside>
  )
}

type BlockGroupPanelProps = {
  group: BlockGroup
  canDeleteGroup: boolean
  busy?: boolean
  pushEpoch: number
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
  onClear: () => void
  onDeleteGroup: () => void
  onShowGroup: () => void
  onOpenSave: () => void
  onOpenRestore: () => void
  onOpenCommit: () => void
  onOpenHide: () => void
}

function BlockGroupPanel({
  group,
  canDeleteGroup,
  busy,
  pushEpoch,
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
  onClear,
  onDeleteGroup,
  onShowGroup,
  onOpenSave,
  onOpenRestore,
  onOpenCommit,
  onOpenHide,
}: BlockGroupPanelProps) {
  const { tasks, anchor } = group
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropLineIndex, setDropLineIndex] = useState<number | null>(null)
  const [listMenuOpen, setListMenuOpen] = useState(false)

  const listRef = useRef<HTMLUListElement>(null)
  const listMenuRef = useRef<HTMLDivElement>(null)
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

  const resolved = useMemo(
    () => resolveStack(tasks, anchor),
    [tasks, anchor],
  )
  const stackSummary =
    resolved.length === 0
      ? null
      : `${timeFmt.format(resolved[0]!.start)} – ${timeFmt.format(resolved[resolved.length - 1]!.end)}`
  const dayKey = localDateKey(anchor.at)
  const isUpdate =
    pushEpoch >= 0 && hasPushedGroupOnDay(group.id, dayKey)
  const pushUnchanged =
    isUpdate &&
    isPushUnchanged(
      selectedCommitId,
      group.id,
      dayKey,
      stackPushFingerprint(anchor, resolved),
    )
  function beginAnchorScrub(e: React.PointerEvent<HTMLInputElement>) {
    if (e.button !== 0) return
    const input = e.currentTarget
    const startY = e.clientY
    const startX = e.clientX
    const pointerId = e.pointerId
    const isTouch = e.pointerType === 'touch'
    let active = false
    let lastTick = 0
    let field: AnchorField = 'minute'

    // On touch, block the native time picker for the whole gesture; a plain
    // tap re-opens it in onUp. Mouse keeps default so caret placement works.
    if (isTouch) e.preventDefault()

    // Claim the gesture immediately so the sidebar doesn't scroll instead.
    try {
      input.setPointerCapture(pointerId)
    } catch {
      /* ignore */
    }

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
          cleanup(false)
          return
        }
        active = true
        field = anchorFieldFromSelection(readSelectionStart(input))
        originIso = currentIso()
        document.body.classList.add('is-datetime-scrubbing')
        input.blur()
      }
      ev.preventDefault()
      const tick = Math.trunc(-dy / ANCHOR_SCRUB_PX)
      if (tick === lastTick) return
      lastTick = tick
      onAnchorChange({ ...anchorRef.current, at: isoForTick(tick) })
    }

    function cleanup(openPicker: boolean) {
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
      if (!openPicker || !isTouch) return
      input.focus()
      try {
        input.showPicker?.()
      } catch {
        /* ignore — not supported or not allowed */
      }
    }

    function onUp(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return
      cleanup(!active)
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

  if (group.hidden) {
    const countText = ` (${blockCountLabel(tasks.length)})`
    return (
      <section className="block-group block-group-collapsed">
        <button
          type="button"
          className="block-group-collapsed-toggle"
          onClick={onShowGroup}
          disabled={busy}
          aria-expanded={false}
        >
          {group.name ? (
            <>
              <span className="block-group-collapsed-title">{group.name}</span>
              <span className="muted block-group-collapsed-count">
                {countText}
              </span>
            </>
          ) : (
            <span className="muted block-group-collapsed-count">
              {countText}
            </span>
          )}
        </button>
      </section>
    )
  }

  return (
    <section className="block-group">
      <div className="stack-anchor">
        <div className="stack-anchor-row">
          <div
            className="segmented segmented-sm"
            role="group"
            aria-label="Stack anchor"
          >
            <button
              type="button"
              className={anchor.kind === 'start' ? 'active' : ''}
              onClick={() => onAnchorChange({ ...anchor, kind: 'start' })}
            >
              Starts
            </button>
            <button
              type="button"
              className={anchor.kind === 'end' ? 'active' : ''}
              onClick={() => onAnchorChange({ ...anchor, kind: 'end' })}
            >
              Ends
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
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {editing ? (
                <TaskFieldsForm
                  initialTitle={task.title}
                  initialDuration={task.durationMinutes}
                  submitLabel="Save"
                  busy={busy}
                  onCancel={() => onEditingIdChange(null)}
                  onSubmit={(next) => {
                    onUpdate({
                      ...task,
                      title: next.title,
                      durationMinutes: next.durationMinutes,
                    })
                    onEditingIdChange(null)
                  }}
                />
              ) : (
                <>
                  <div
                    className="task-card-main task-card-drag"
                    onPointerDown={(e) => beginTaskDrag(e, index)}
                  >
                    <span className="task-title">
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
              <button
                type="button"
                className="task-new-trigger"
                onClick={onStartAdd}
                disabled={busy}
              >
                New block +
              </button>
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
                        className="calendar-menu-item"
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
                        className="calendar-menu-item"
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
                        disabled={busy || tasks.length === 0}
                        onClick={() => {
                          setListMenuOpen(false)
                          onClear()
                        }}
                      >
                        Clear blocks
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="calendar-menu-item"
                        disabled={busy}
                        onClick={() => {
                          setListMenuOpen(false)
                          onOpenHide()
                        }}
                      >
                        Hide block group
                      </button>
                      <div className="calendar-menu-sep" role="separator" />
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

function TaskFieldsForm({
  initialTitle,
  initialDuration,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initialTitle: string
  initialDuration: number
  submitLabel: string
  busy?: boolean
  onSubmit: (task: Omit<Task, 'id'>) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initialTitle)
  const [durationMinutes, setDurationMinutes] = useState<number | ''>(
    initialDuration,
  )
  const durationRef = useRef(durationMinutes)
  durationRef.current = durationMinutes

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  function parseDuration(value: number | ''): number {
    if (value === '') return 15
    return Math.max(1, Math.round(value) || 15)
  }

  function beginDurationScrub(e: React.PointerEvent<HTMLInputElement>) {
    if (e.button !== 0) return
    // Claim the gesture so the number input doesn't start a text-drag.
    // Focus is restored on a plain click (no scrub) in onUp.
    e.preventDefault()
    const input = e.currentTarget
    const startY = e.clientY
    const startX = e.clientX
    const pointerId = e.pointerId
    let active = false
    let lastTick = 0
    const origin = parseDuration(durationRef.current)

    function durationForTick(tick: number): number {
      if (tick === 0) return origin
      if (tick > 0) {
        const floor = Math.floor(origin / 5) * 5
        return Math.max(1, floor + tick * 5)
      }
      const ceil = Math.ceil(origin / 5) * 5
      return Math.max(1, ceil + tick * 5)
    }

    try {
      input.setPointerCapture(pointerId)
    } catch {
      /* ignore */
    }

    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!active) {
        if (Math.abs(dy) < ANCHOR_SCRUB_ACTIVATE_PX) return
        if (Math.abs(dy) < Math.abs(dx)) {
          cleanup(false)
          return
        }
        active = true
        document.body.classList.add('is-datetime-scrubbing')
      }
      ev.preventDefault()
      const tick = Math.trunc(-dy / ANCHOR_SCRUB_PX)
      if (tick === lastTick) return
      lastTick = tick
      setDurationMinutes(durationForTick(tick))
    }

    function cleanup(focusForTyping: boolean) {
      input.removeEventListener('pointermove', onMove)
      input.removeEventListener('pointerup', onUp)
      input.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('is-datetime-scrubbing')
      try {
        if (input.hasPointerCapture(pointerId)) {
          input.releasePointerCapture(pointerId)
        }
      } catch {
        /* ignore */
      }
      if (focusForTyping) {
        input.focus()
        input.select()
      }
    }

    function onUp(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return
      cleanup(!active)
    }

    // Listen on the capture target — with setPointerCapture, moves go here.
    input.addEventListener('pointermove', onMove, { passive: false })
    input.addEventListener('pointerup', onUp)
    input.addEventListener('pointercancel', onUp)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    onSubmit({
      title: title.trim(),
      durationMinutes: parseDuration(durationMinutes),
    })
  }

  return (
    <form className="task-form" onSubmit={handleSubmit} noValidate>
      <input
        className="task-form-name"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Event Name"
        aria-label="Event name"
        required
        autoFocus
      />
      <div className="task-form-row">
        <div className="task-form-duration">
          <input
            type="number"
            min={1}
            step="any"
            value={durationMinutes}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') {
                setDurationMinutes('')
                return
              }
              const next = Number(raw)
              setDurationMinutes(Number.isFinite(next) ? next : '')
            }}
            onBlur={() => {
              setDurationMinutes(parseDuration(durationMinutes))
            }}
            onPointerDown={beginDurationScrub}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                const current = parseDuration(durationMinutes)
                const next =
                  e.key === 'ArrowUp'
                    ? current + 5
                    : Math.max(1, current - 5)
                setDurationMinutes(next)
                return
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            aria-label="Duration in minutes"
          />
          <span className="muted">mins</span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={busy}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
