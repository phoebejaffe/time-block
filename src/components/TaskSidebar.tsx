import { useEffect, useMemo, useRef, useState } from 'react'
import type { GoogleCalendar } from '../lib/calendarApi'
import type { SavedTaskList, StackAnchor, Task } from '../lib/tasks'
import {
  deleteSavedList,
  fromLocalInputValue,
  loadSavedLists,
  loadTargetCalendarId,
  resolveStack,
  saveTargetCalendarId,
  saveTaskList,
  tasksFromSavedList,
  toLocalInputValue,
} from '../lib/tasks'
import type { Notice } from '../lib/notice'
import { SignOutButton } from './AuthButton'

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

const NEW_EDIT_ID = '__new__'
const TOUCH_LONG_PRESS_MS = 320
const TOUCH_CANCEL_MOVE_PX = 12
const MOUSE_ACTIVATE_PX = 5

type TaskSidebarProps = {
  tasks: Task[]
  anchor: StackAnchor
  writableCalendars: GoogleCalendar[]
  onAdd: (task: Omit<Task, 'id'>) => void
  onUpdate: (task: Task) => void
  onRemove: (id: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onAnchorChange: (anchor: StackAnchor) => void
  onReplaceTasks: (tasks: Task[]) => void
  onClear: () => void
  onCommit: (calendarId: string) => Promise<void>
  editingId: string | null
  onEditingIdChange: (id: string | null) => void
  busy?: boolean
  notice?: Notice | null
  signedIn?: boolean
  onSignOut?: () => void
}

function isTodayOrTomorrow(iso: string): boolean {
  const target = new Date(iso)
  if (Number.isNaN(target.getTime())) return true
  const startOfDay = (d: Date) => {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    return x.getTime()
  }
  const today = startOfDay(new Date())
  const tomorrowDate = new Date()
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const tomorrow = startOfDay(tomorrowDate)
  const day = startOfDay(target)
  return day === today || day === tomorrow
}

export function TaskSidebar({
  tasks,
  anchor,
  writableCalendars,
  onAdd,
  onUpdate,
  onRemove,
  onReorder,
  onAnchorChange,
  onReplaceTasks,
  onClear,
  onCommit,
  editingId,
  onEditingIdChange,
  busy,
  notice,
  signedIn,
  onSignOut,
}: TaskSidebarProps) {
  const [commitCalendarId, setCommitCalendarId] = useState(loadTargetCalendarId)
  const [savedLists, setSavedLists] = useState<SavedTaskList[]>(() =>
    loadSavedLists(),
  )
  const [saveName, setSaveName] = useState('')
  const [selectedSavedId, setSelectedSavedId] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropLineIndex, setDropLineIndex] = useState<number | null>(null)
  const [modal, setModal] = useState<'save' | 'restore' | 'commit' | null>(null)

  const listRef = useRef<HTMLUListElement>(null)
  const dropLineIndexRef = useRef<number | null>(null)
  const suppressClickRef = useRef(false)
  const tasksLengthRef = useRef(tasks.length)
  useEffect(() => {
    dropLineIndexRef.current = dropLineIndex
  }, [dropLineIndex])

  useEffect(() => {
    tasksLengthRef.current = tasks.length
  }, [tasks.length])

  useEffect(() => {
    if (!editingId || editingId === NEW_EDIT_ID) return
    if (!tasks.some((t) => t.id === editingId)) {
      onEditingIdChange(null)
      return
    }
    const card = listRef.current?.querySelector(
      `[data-task-id="${CSS.escape(editingId)}"]`,
    )
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [editingId, tasks, onEditingIdChange])

  const resolved = useMemo(
    () => resolveStack(tasks, anchor),
    [tasks, anchor],
  )
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

  function handleTargetCalendarChange(id: string) {
    setCommitCalendarId(id)
    saveTargetCalendarId(id)
  }

  const stackSummary =
    resolved.length === 0
      ? null
      : `${timeFmt.format(resolved[0]!.start)} – ${timeFmt.format(resolved[resolved.length - 1]!.end)}`

  const adding = editingId === NEW_EDIT_ID
  const anchorFarFromToday = !isTodayOrTomorrow(anchor.at)

  async function handleCommit() {
    if (!selectedCommitId) return
    await onCommit(selectedCommitId)
  }

  function handleSaveList(e: React.FormEvent) {
    e.preventDefault()
    if (tasks.length === 0) return
    const saved = saveTaskList(saveName || 'Morning', tasks)
    setSaveName(saved.name)
    refreshSavedLists(saved.id)
    setModal(null)
  }

  function handleLoadList() {
    const list =
      savedLists.find((l) => l.id === selectedSavedId) || savedLists[0]
    if (!list) return
    onReplaceTasks(tasksFromSavedList(list))
    setSaveName(list.name)
    setSelectedSavedId(list.id)
    setModal(null)
  }

  function handleDeleteList() {
    const id = selectedSavedId || savedLists[0]?.id
    if (!id) return
    deleteSavedList(id)
    refreshSavedLists()
  }

  function openRestoreModal() {
    refreshSavedLists()
    setModal('restore')
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
    }
  }

  function handleDropAt(insertAt: number, from: number) {
    setDragIndex(null)
    setDropLineIndex(null)
    const len = tasksLengthRef.current
    if (!Number.isInteger(from) || from < 0 || from >= len) {
      return
    }
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
    e: React.PointerEvent<HTMLLIElement>,
    index: number,
  ) {
    if ((e.target as HTMLElement).closest('button, input, a')) return
    if (e.button !== 0 && e.pointerType === 'mouse') return

    const card = e.currentTarget
    const pointerId = e.pointerId
    const startX = e.clientX
    const startY = e.clientY
    const pointerType = e.pointerType
    let active = false
    let longPressTimer: number | null = null
    let cancelled = false

    const endReorderSession = () => {
      document.body.classList.remove('is-task-reordering')
      setDragIndex(null)
      setDropLineIndex(null)
      dropLineIndexRef.current = null
    }

    const activate = () => {
      if (cancelled || active) return
      active = true
      try {
        card.setPointerCapture(pointerId)
      } catch {
        /* ignore */
      }
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
        if (pointerType === 'touch') {
          if (dist > TOUCH_CANCEL_MOVE_PX) {
            cancelled = true
            if (longPressTimer !== null) window.clearTimeout(longPressTimer)
            cleanupListeners()
          }
          return
        }
        if (dist >= MOUSE_ACTIVATE_PX) activate()
        return
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
      if (longPressTimer !== null) window.clearTimeout(longPressTimer)
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
      if (longPressTimer !== null) window.clearTimeout(longPressTimer)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
      try {
        if (card.hasPointerCapture(pointerId)) {
          card.releasePointerCapture(pointerId)
        }
      } catch {
        /* ignore */
      }
    }

    document.addEventListener('pointermove', onMove, { passive: false })
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)

    if (pointerType === 'touch') {
      longPressTimer = window.setTimeout(activate, TOUCH_LONG_PRESS_MS)
    } else {
      try {
        card.setPointerCapture(pointerId)
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <aside className="task-sidebar">
      <div className="task-list-header">
        <div className="task-list-brand">
          <span className="brand-mark brand-mark-sm" aria-hidden />
          <h3>Timeblock</h3>
        </div>
        <div className="task-list-meta">
          {stackSummary && (
            <span className="task-range muted">{stackSummary}</span>
          )}
          {signedIn && onSignOut && (
            <SignOutButton busy={busy} onSignOut={onSignOut} />
          )}
        </div>
      </div>

      <section className="stack-anchor">
        <div className="stack-anchor-row">
          <div className="segmented segmented-sm" role="group" aria-label="Stack anchor">
            <button
              type="button"
              className={anchor.kind === 'end' ? 'active' : ''}
              onClick={() => onAnchorChange({ ...anchor, kind: 'end' })}
            >
              Ends
            </button>
            <button
              type="button"
              className={anchor.kind === 'start' ? 'active' : ''}
              onClick={() => onAnchorChange({ ...anchor, kind: 'start' })}
            >
              Starts
            </button>
          </div>
          <label className="stack-anchor-time">
            <span className="sr-only">
              {anchor.kind === 'end' ? 'List ends at' : 'List starts at'}
            </span>
            <input
              type="datetime-local"
              step={300}
              value={toLocalInputValue(anchor.at)}
              onChange={(e) => {
                // Ignore transient empty values while typing segments.
                if (!e.target.value) return
                onAnchorChange({
                  ...anchor,
                  at: fromLocalInputValue(e.target.value),
                })
              }}
            />
          </label>
        </div>
        {anchorFarFromToday && (
          <p className="stack-anchor-warning" role="status">
            Not today or tomorrow
          </p>
        )}
      </section>

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
              onPointerDown={(e) => {
                if (editing) return
                beginTaskDrag(e, index)
              }}
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
                  <div className="task-card-main">
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
                        if (
                          window.confirm(
                            `Remove “${task.title}” from the list?`,
                          )
                        ) {
                          onRemove(task.id)
                        }
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
              onCancel={() => onEditingIdChange(null)}
              onSubmit={(next) => {
                onAdd(next)
                onEditingIdChange(null)
              }}
            />
          ) : (
            <button
              type="button"
              className="task-new-trigger"
              onClick={() => onEditingIdChange(NEW_EDIT_ID)}
              disabled={busy}
            >
              New block +
            </button>
          )}
        </li>
      </ul>

      <div className="sidebar-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setModal('save')}
          disabled={busy || tasks.length === 0}
        >
          Save blocks
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={openRestoreModal}
          disabled={busy}
        >
          Restore blocks
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onClear}
          disabled={busy || tasks.length === 0}
        >
          Clear
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm sidebar-action-commit"
          onClick={() => setModal('commit')}
          disabled={busy || tasks.length === 0}
        >
          Add to calendar
        </button>
        {notice && !modal && (
          <p
            className={`notice notice-${notice.kind}`}
            role={notice.kind === 'error' ? 'alert' : 'status'}
          >
            {notice.text}
          </p>
        )}
      </div>

      {modal === 'save' && (
        <Modal title="Save block list" onClose={() => setModal(null)}>
          <form className="modal-form" onSubmit={handleSaveList}>
            <label>
              <span>List name</span>
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Morning"
                aria-label="Saved list name"
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={busy || tasks.length === 0}
              >
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === 'restore' && (
        <Modal title="Restore block list" onClose={() => setModal(null)}>
          {savedLists.length === 0 ? (
            <p className="muted">No saved block lists yet.</p>
          ) : (
            <div className="modal-form">
              <label>
                <span>Saved list</span>
                <select
                  value={selectedSavedId || savedLists[0]?.id || ''}
                  onChange={(e) => setSelectedSavedId(e.target.value)}
                  aria-label="Saved list"
                  autoFocus
                >
                  {savedLists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name} ({list.tasks.length})
                    </option>
                  ))}
                </select>
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleDeleteList}
                  disabled={busy}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleLoadList}
                  disabled={busy}
                >
                  Restore
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {modal === 'commit' && (
        <Modal title="Add to calendar" onClose={() => setModal(null)}>
          <div className="modal-form">
            <label>
              <span>Target calendar</span>
              <select
                value={selectedCommitId}
                onChange={(e) => handleTargetCalendarChange(e.target.value)}
                disabled={!writableCalendars.length || busy}
                autoFocus
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
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handleCommit()}
                disabled={busy || tasks.length === 0 || !selectedCommitId}
              >
                {busy ? 'Adding…' : 'Add to calendar'}
              </button>
            </div>
            {notice && (
              <p
                className={`notice notice-${notice.kind}`}
                role={notice.kind === 'error' ? 'alert' : 'status'}
              >
                {notice.text}
              </p>
            )}
          </div>
        </Modal>
      )}
    </aside>
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
    return Math.max(5, Math.round(value) || 15)
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
            min={5}
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
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                const current = parseDuration(durationMinutes)
                const next =
                  e.key === 'ArrowUp'
                    ? current + 5
                    : Math.max(5, current - 5)
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
