import { useMemo, useState } from 'react'
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
  const [title, setTitle] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(30)
  const [commitCalendarId, setCommitCalendarId] = useState(loadTargetCalendarId)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [savedLists, setSavedLists] = useState<SavedTaskList[]>(() =>
    loadSavedLists(),
  )
  const [saveName, setSaveName] = useState('')
  const [selectedSavedId, setSelectedSavedId] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropLineIndex, setDropLineIndex] = useState<number | null>(null)

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

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    onAdd({
      title: title.trim(),
      durationMinutes: Math.max(1, Math.round(durationMinutes) || 1),
    })
    setTitle('')
  }

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

  return (
    <aside className="task-sidebar">
      <header className="sidebar-header">
        <h2>Plan</h2>
      </header>

      <form className="task-form" onSubmit={handleAdd}>
        <label>
          <span>Task</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Slow wake, bathroom, pack…"
            required
          />
        </label>

        <label>
          <span>Duration (min)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={durationMinutes}
            onChange={(e) =>
              setDurationMinutes(
                Math.max(1, Math.round(Number(e.target.value)) || 1),
              )
            }
          />
        </label>

        <button type="submit" className="btn btn-primary" disabled={busy}>
          Add task
        </button>
      </form>

      <div className="task-list-header">
        <h3>
          Tasks
          {stackSummary && (
            <span className="task-range muted"> {stackSummary}</span>
          )}
        </h3>
      </div>

      {tasks.length === 0 ? (
        <p className="muted empty-hint">No local tasks yet.</p>
      ) : (
        <ul className="task-list">
          {tasks.map((task, index) => {
            const editing = editingId === task.id
            const showLineBefore =
              dropLineIndex === index &&
              dragIndex !== null &&
              dropLineIndex !== dragIndex &&
              dropLineIndex !== dragIndex + 1
            const showLineAfter =
              index === tasks.length - 1 &&
              dropLineIndex === tasks.length &&
              dragIndex !== null &&
              dropLineIndex !== dragIndex &&
              dropLineIndex !== dragIndex + 1

            return (
              <li
                key={task.id}
                className={[
                  'task-card',
                  dragIndex === index ? 'is-dragging' : '',
                  showLineBefore ? 'drop-line-before' : '',
                  showLineAfter ? 'drop-line-after' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                draggable={!editing}
                onDragStart={(e) => {
                  if (editing || (e.target as HTMLElement).closest('button')) {
                    e.preventDefault()
                    return
                  }
                  setDragIndex(index)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', String(index))
                }}
                onDragEnd={() => {
                  setDragIndex(null)
                  setDropLineIndex(null)
                }}
                onDragOver={(e) => {
                  if (dragIndex === null || editing) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  const rect = e.currentTarget.getBoundingClientRect()
                  const after = e.clientY > rect.top + rect.height / 2
                  const nextLine = after ? index + 1 : index
                  if (dropLineIndex !== nextLine) setDropLineIndex(nextLine)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const from =
                    dragIndex ??
                    Number(e.dataTransfer.getData('text/plain'))
                  const insertAt = dropLineIndex
                  setDragIndex(null)
                  setDropLineIndex(null)
                  if (
                    !Number.isInteger(from) ||
                    insertAt === null ||
                    from < 0 ||
                    from >= tasks.length
                  ) {
                    return
                  }
                  // No-op if dropping into the same slot.
                  if (insertAt === from || insertAt === from + 1) return
                  const to = from < insertAt ? insertAt - 1 : insertAt
                  onReorder(from, to)
                }}
              >
                {editing ? (
                  <TaskEditor
                    task={task}
                    onSave={(next) => {
                      onUpdate(next)
                      setEditingId(null)
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <div className="task-card-main">
                      <span className="task-title">
                        <span className="task-index">{index + 1}.</span>{' '}
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
                        onClick={() => setEditingId(task.id)}
                      >
                        <EditIcon />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Remove ${task.title}`}
                        title="Remove"
                        onClick={() => {
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
        </ul>
      )}

      <section className="stack-anchor">
        <div className="segmented" role="group" aria-label="Stack anchor">
          <button
            type="button"
            className={anchor.kind === 'end' ? 'active' : ''}
            onClick={() => onAnchorChange({ ...anchor, kind: 'end' })}
          >
            Ends at
          </button>
          <button
            type="button"
            className={anchor.kind === 'start' ? 'active' : ''}
            onClick={() => onAnchorChange({ ...anchor, kind: 'start' })}
          >
            Starts at
          </button>
        </div>
        <label>
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
      </section>

      <section className="saved-lists">
        <h3>Saved lists</h3>
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

function TaskEditor({
  task,
  onSave,
  onCancel,
}: {
  task: Task
  onSave: (task: Task) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(task.title)
  const [durationMinutes, setDurationMinutes] = useState(task.durationMinutes)

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    onSave({
      ...task,
      title: title.trim() || task.title,
      durationMinutes: Math.max(1, Math.round(durationMinutes) || 1),
    })
  }

  return (
    <form className="task-editor" onSubmit={handleSave}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Title"
      />
      <input
        type="number"
        min={1}
        step={1}
        value={durationMinutes}
        onChange={(e) =>
          setDurationMinutes(Math.max(1, Math.round(Number(e.target.value)) || 1))
        }
        aria-label="Duration minutes"
      />
      <div className="task-card-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm">
          Save
        </button>
      </div>
    </form>
  )
}
