import { useState } from 'react'
import { BlockLibraryModal } from './components/BlockLibraryModal'
import { BlockGroupPanel, type BlockGroupPanelProps } from './components/TaskSidebar'
import {
  createBlockGroup,
  createSavedBlock,
  createTask,
  type BlockLibrary,
  type BlockGroup,
  type Task,
} from './lib/tasks'

const noop = () => {}

function makeTasks(): Task[] {
  return Array.from({ length: 18 }, (_, index) =>
    createTask({ title: `Task ${index + 1}`, durationMinutes: 15 }),
  )
}

function makeLibrary(): BlockLibrary {
  return {
    updatedAt: new Date().toISOString(),
    categories: [
      {
        id: 'morning',
        name: 'Morning',
        blocks: Array.from({ length: 18 }, (_, index) =>
          createSavedBlock({ title: `Library ${index + 1}`, durationMinutes: 15 }),
        ),
      },
    ],
  }
}

export function E2eHarness() {
  const [group, setGroup] = useState<BlockGroup>(() =>
    createBlockGroup({ id: 'e2e-group', name: 'E2E plan', tasks: makeTasks() }),
  )
  const [library, setLibrary] = useState(makeLibrary)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [mode, setMode] = useState<'planning' | 'execution'>('planning')

  const panelProps: BlockGroupPanelProps = {
    group,
    collapsedLabel: 'E2E plan',
    canDeleteGroup: false,
    canMoveGroupUp: false,
    canMoveGroupDown: false,
    mode,
    pushedEvents: [],
    pushSnapshots: [],
    editingId: null,
    adding: false,
    onEditingIdChange: noop,
    onStartAdd: noop,
    onCancelAdd: noop,
    onAdd: (task, index) =>
      setGroup((current) => ({
        ...current,
        tasks: index == null
          ? [...current.tasks, createTask(task)]
          : [...current.tasks.slice(0, index), createTask(task), ...current.tasks.slice(index)],
      })),
    onUpdate: (task) =>
      setGroup((current) => ({
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? task : item)),
      })),
    onRemove: (id) =>
      setGroup((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== id) })),
    onReorder: (from, to) =>
      setGroup((current) => {
        const tasks = [...current.tasks]
        const [task] = tasks.splice(from, 1)
        if (!task) return current
        tasks.splice(to, 0, task)
        return { ...current, tasks }
      }),
    onAnchorChange: noop,
    onDeleteGroup: noop,
    onDuplicateGroup: noop,
    onArchiveGroup: noop,
    onMoveGroupUp: noop,
    onMoveGroupDown: noop,
    onSaveCheckpoint: noop,
    onRevertToCheckpoint: noop,
    onGotDelayed: noop,
    onSetGroupEnabled: noop,
    onOpenCommit: noop,
    onDeleteFromCalendar: noop,
    onTaskEditPreview: noop,
    onOpenName: noop,
    onSetGroupColor: noop,
    blockLibrary: library,
    onAddFromLibrary: (inputs, index) => {
      setGroup((current) => {
        const inserted = inputs.map((input) => createTask(input))
        const at = index ?? current.tasks.length
        return { ...current, tasks: [...current.tasks.slice(0, at), ...inserted, ...current.tasks.slice(at)] }
      })
    },
    onAddToLibrary: noop,
    timeStepMinutes: 5,
    defaultBlockMinutes: 30,
  }

  return (
    <div className="e2e-harness">
      <div className="e2e-harness-toolbar">
        <button type="button" onClick={() => setLibraryOpen(true)}>
          Open block library
        </button>
        <button type="button" onClick={() => setMode('planning')}>
          Planning mode
        </button>
        <button type="button" onClick={() => setMode('execution')}>
          Execution mode
        </button>
      </div>
      <div className="e2e-harness-panel">
        <BlockGroupPanel {...panelProps} />
      </div>
      {libraryOpen && (
        <BlockLibraryModal
          library={library}
          onChange={setLibrary}
          onClose={() => setLibraryOpen(false)}
        />
      )}
    </div>
  )
}
