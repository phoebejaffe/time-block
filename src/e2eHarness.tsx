import { useEffect, useState } from 'react'
import { BlockLibraryModal } from './components/BlockLibraryModal'
import { ExecutionModal } from './components/ExecutionModal'
import { BlockGroupPanel, type BlockGroupPanelProps } from './components/TaskSidebar'
import type { GoogleCalendar } from './lib/calendarApi'
import type { PushedEvent } from './lib/pushedEvents'
import { usePlan } from './hooks/usePlan'
import {
  createBlockGroup,
  createSavedBlock,
  createTask,
  stackDayKey,
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

const OVERNIGHT_CALENDAR: GoogleCalendar = {
  id: 'e2e-overnight-calendar',
  summary: 'E2E Calendar',
  backgroundColor: '#4285f4',
  foregroundColor: '#ffffff',
  primary: true,
  accessRole: 'owner',
}

/**
 * Repro scenario for overnight runs: a Starts-anchored plan that began
 * yesterday at 22:00 and ends ~00:30, already pushed under yesterday's day
 * key. "Start overnight run" enters execution through the real
 * `usePlan.beginExecution` path.
 */
function OvernightRunHarness() {
  const plan = usePlan()
  const { beginExecution, replacePlan } = plan
  const [runOpen, setRunOpen] = useState(false)
  const [pushedEvents, setPushedEvents] = useState<PushedEvent[]>([])

  useEffect(() => {
    const start = new Date()
    start.setDate(start.getDate() - 1)
    start.setHours(22, 0, 0, 0)
    const group = createBlockGroup({
      id: 'e2e-overnight',
      name: 'Overnight plan',
      anchor: { kind: 'start', at: start.toISOString() },
      tasks: [
        createTask({ title: 'Wind down', durationMinutes: 90 }),
        createTask({ title: 'Sleep prep', durationMinutes: 60 }),
      ],
    })
    const dayKey = stackDayKey(group.tasks, group.anchor)
    setPushedEvents(
      group.tasks.map((task) => ({
        calendarId: OVERNIGHT_CALENDAR.id,
        eventId: `e2e-ev-${task.id}`,
        taskId: task.id,
        groupId: group.id,
        dayKey,
        pushedAt: new Date().toISOString(),
      })),
    )
    replacePlan({ groups: [group] })
  }, [replacePlan])

  const group = plan.plan.groups.find((g) => g.id === 'e2e-overnight')

  return (
    <div className="e2e-harness">
      <div className="e2e-harness-toolbar">
        <button
          type="button"
          disabled={!group}
          onClick={() => {
            beginExecution('e2e-overnight')
            setRunOpen(true)
          }}
        >
          Start overnight run
        </button>
      </div>
      {runOpen && group && (
        <ExecutionModal
          group={group}
          groupsForSidebar={[group]}
          calendarGroups={[group]}
          googleEvents={[]}
          calendars={[OVERNIGHT_CALENDAR]}
          visibleCalendarIds={new Set([OVERNIGHT_CALENDAR.id])}
          onToggleCalendar={noop}
          writableCalendars={[OVERNIGHT_CALENDAR]}
          onAdd={plan.addTask}
          onAddBlocks={plan.addTasks}
          onUpdate={plan.updateTask}
          onRemove={plan.removeTask}
          onReorder={plan.reorderTasks}
          onAnchorChange={plan.setAnchor}
          onGotDelayed={(groupId) =>
            plan.insertGotDelayed(groupId, new Date(), true)
          }
          onIntendedEndChange={plan.setIntendedEndAt}
          onSaveCheckpoint={plan.saveCheckpoint}
          onRevertToCheckpoint={plan.revertToCheckpoint}
          onSetGroupName={plan.setGroupName}
          onSetGroupColor={plan.setGroupColor}
          onSetGroupEnabled={plan.setGroupEnabled}
          onCommit={async () => true}
          onDeleteFromCalendar={async () => {}}
          onTaskEditPreview={noop}
          editingId={null}
          onEditingIdChange={noop}
          onDatesSet={noop}
          onTaskClick={noop}
          targetCalendarId={OVERNIGHT_CALENDAR.id}
          onTargetCalendarChange={noop}
          pushedEvents={pushedEvents}
          pushSnapshots={[]}
          blockLibrary={{ updatedAt: '', categories: [] }}
          onReplaceBlockLibrary={noop}
          planArchive={{ folders: [], updatedAt: '' }}
          onReplacePlanArchive={noop}
          onAddArchivedToHome={() => ''}
          savedCalendarUsers={[]}
          onReplaceSavedCalendarUsers={noop}
          onClose={() => setRunOpen(false)}
          onEndExecution={() => setRunOpen(false)}
        />
      )}
    </div>
  )
}

export function E2eHarness() {
  if (
    new URLSearchParams(window.location.search).get('e2e') === 'overnight-run'
  ) {
    return <OvernightRunHarness />
  }
  return <PanelHarness />
}

function PanelHarness() {
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
