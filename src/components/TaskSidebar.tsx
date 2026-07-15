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
  onCommit: (calendarId: string) => Promise<void>
  busy?: boolean
  notice?: { kind: 'success' | 'error' | 'info'; text: string } | null
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
  onCommit,
  busy,
  notice,
}: TaskSidebarProps) {
  const [commitCalendarId, setCommitCalendarId] = useState(loadTargetCalendarId)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [savedLists, setSavedLists] = useState<SavedTaskList[]>(() =>
    loadSavedLists(),
  )
  const [saveName, setSaveName] = useState('')
  const [selectedSavedId, setSelectedSavedId] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropLineIndex, setDropLineIndex] = useState<number | null>(null)

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

  async function handleCommit() {
    if (!selectedCommitId) return
    await onCommit(selectedCommitId)
  }

  function handleAnchorKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const deltaMs = (e.key === 'ArrowUp' ? 5 : -5) * 60_000
    onAnchorChange({
      ...anchor,
      at: new Date(new Date(anchor.at).getTime() + deltaMs).toISOString(),
    })
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

  function handleSaveList(e: React.FormEvent) {
    e.preventDefault()
    if (tasks.length === 0) return
    const saved = saveTaskList(saveName || 'Morning', tasks)
    setSaveName(saved.name)
    refreshSavedLists(saved.id)
  }

  function handleLoadList() {
    const list =
      savedLists.find((l) => l.id === selectedSavedId) || savedLists[0]
    if (!list) return
    onReplaceTasks(tasksFromSavedList(list))
    setSaveName(list.name)
    setSelectedSavedId(list.id)
  }

  function handleDeleteList() {
    const id = selectedSavedId || savedLists[0]?.id
    if (!id) return
    deleteSavedList(id)
    refreshSavedLists()
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
        <h3>Tasks</h3>
        {stackSummary && (
          <span className="task-range muted">{stackSummary}</span>
        )}
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
              onChange={(e) =>
                onAnchorChange({
                  ...anchor,
                  at: fromLocalInputValue(e.target.value),
                })
              }
              onKeyDown={handleAnchorKeyDown}
            />
          </label>
        </div>
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
                  onCancel={() => setEditingId(null)}
                  onSubmit={(next) => {
                    onUpdate({
                      ...task,
                      title: next.title,
                      durationMinutes: next.durationMinutes,
                    })
                    setEditingId(null)
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
                        setEditingId(task.id)
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
              onCancel={() => setEditingId(null)}
              onSubmit={(next) => {
                onAdd(next)
                setEditingId(null)
              }}
            />
          ) : (
            <button
              type="button"
              className="task-new-trigger"
              onClick={() => setEditingId(NEW_EDIT_ID)}
              disabled={busy}
            >
              New +
            </button>
          )}
        </li>
      </ul>

      <section className="saved-lists">
        <h3>Saved task lists</h3>
        <form className="saved-lists-save" onSubmit={handleSaveList}>
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="List name"
            aria-label="Saved list name"
          />
          <button
            type="submit"
            className="btn btn-ghost"
            disabled={busy || tasks.length === 0}
          >
            Save
          </button>
        </form>
        {savedLists.length > 0 && (
          <div className="saved-lists-load">
            <select
              value={selectedSavedId || savedLists[0]?.id || ''}
              onChange={(e) => setSelectedSavedId(e.target.value)}
              aria-label="Saved list"
            >
              {savedLists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name} ({list.tasks.length})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleLoadList}
              disabled={busy}
            >
              Load
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleDeleteList}
              disabled={busy}
            >
              Delete
            </button>
          </div>
        )}
      </section>

      <div className="finish-panel">
        <h3>Add to calendar</h3>

        <label>
          <span>Target calendar</span>
          <select
            value={selectedCommitId}
            onChange={(e) => handleTargetCalendarChange(e.target.value)}
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

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handleCommit()}
          disabled={busy || tasks.length === 0 || !selectedCommitId}
        >
          {busy ? 'Adding…' : 'Add to calendar'}
        </button>
        {notice && (
          <p
            className={`notice notice-${notice.kind}`}
            role={notice.kind === 'error' ? 'alert' : 'status'}
          >
            {notice.text}
          </p>
        )}
      </div>
    </aside>
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
            step={5}
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
