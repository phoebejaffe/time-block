import { useCallback, useState } from 'react'
import {
  applyGotDelayed,
  createBlockGroup,
  createCheckpoint,
  createTask,
  defaultPlan,
  isTaskDelay,
  prepareGroupForExecution,
  shiftAnchor,
  tasksFromCheckpoint,
  type BlockGroup,
  type BlockGroupCheckpoint,
  type Plan,
  type StackAnchor,
  type Task,
} from '../lib/tasks'
import {
  blockGroupFromArchivedPlan,
  type ArchivedPlan,
} from '../lib/planArchive'

function mapGroup(
  groups: BlockGroup[],
  groupId: string,
  update: (group: BlockGroup) => BlockGroup,
): BlockGroup[] {
  return groups.map((g) => (g.id === groupId ? update(g) : g))
}

/**
 * Plan state lives only in memory here — it's cross-device data, so the
 * source of truth is Firestore (see `useUserData`), not this device's storage.
 * Starts empty; `replacePlan` fills it in once the initial Firestore load
 * (or a later sign-in) resolves.
 */
export function usePlan() {
  const [plan, setPlan] = useState<Plan>(() => defaultPlan())

  const updatePlan = useCallback((updater: (prev: Plan) => Plan) => {
    setPlan((prev) => updater(prev))
  }, [])

  const addGroup = useCallback(() => {
    let id = ''
    updatePlan((prev) => {
      const group = createBlockGroup()
      id = group.id
      return { groups: [...prev.groups, group] }
    })
    return id
  }, [updatePlan])

  const removeGroup = useCallback(
    (groupId: string) => {
      updatePlan((prev) => {
        if (prev.groups.length <= 1) {
          return { groups: [createBlockGroup({ id: prev.groups[0]?.id })] }
        }
        return { groups: prev.groups.filter((g) => g.id !== groupId) }
      })
    },
    [updatePlan],
  )

  const duplicateGroup = useCallback(
    (groupId: string) => {
      updatePlan((prev) => {
        const source = prev.groups.find((g) => g.id === groupId)
        if (!source) return prev
        const duplicate = createBlockGroup({
          tasks: source.tasks.map((task) =>
            createTask({
              title: task.title,
              durationMinutes: task.durationMinutes,
              ...(task.empty || task.delay ? { empty: true } : {}),
              ...(task.delay ? { delay: true } : {}),
              ...(task.disabled ? { disabled: true } : {}),
            }),
          ),
          anchor: { ...source.anchor },
          ...(source.name ? { name: source.name } : {}),
          ...(source.color ? { color: source.color } : {}),
          ...(source.enabled === false ? { enabled: false } : {}),
        })
        const index = prev.groups.findIndex((g) => g.id === groupId)
        const groups = [...prev.groups]
        groups.splice(index + 1, 0, duplicate)
        return { groups }
      })
    },
    [updatePlan],
  )

  const insertGroupAt = useCallback(
    (group: BlockGroup, index: number) => {
      updatePlan((prev) => {
        const groups = [...prev.groups]
        const at = Math.max(0, Math.min(index, groups.length))
        groups.splice(at, 0, group)
        return { groups }
      })
    },
    [updatePlan],
  )

  const addGroupFromArchived = useCallback(
    (archived: ArchivedPlan) => {
      let id = ''
      updatePlan((prev) => {
        const group = blockGroupFromArchivedPlan(archived)
        id = group.id
        return { groups: [...prev.groups, group] }
      })
      return id
    },
    [updatePlan],
  )

  const moveGroup = useCallback(
    (groupId: string, direction: 'up' | 'down') => {
      updatePlan((prev) => {
        const index = prev.groups.findIndex((g) => g.id === groupId)
        if (index < 0) return prev
        const target = direction === 'up' ? index - 1 : index + 1
        if (target < 0 || target >= prev.groups.length) return prev
        const groups = [...prev.groups]
        const [moved] = groups.splice(index, 1)
        if (!moved) return prev
        groups.splice(target, 0, moved)
        return { groups }
      })
    },
    [updatePlan],
  )

  const addTask = useCallback(
    (groupId: string, input: Omit<Task, 'id'>) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => ({
          ...g,
          tasks: [...g.tasks, createTask(input)],
        })),
      }))
    },
    [updatePlan],
  )

  const addTasks = useCallback(
    (groupId: string, inputs: Omit<Task, 'id'>[]) => {
      if (inputs.length === 0) return
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => ({
          ...g,
          tasks: [...g.tasks, ...inputs.map((input) => createTask(input))],
        })),
      }))
    },
    [updatePlan],
  )

  const updateTask = useCallback(
    (groupId: string, task: Task) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => {
          const previous = g.tasks.find((t) => t.id === task.id)
          let next = task
          if (previous && isTaskDelay(previous)) {
            // Clearing empty demotes a delay; otherwise keep the delay flag.
            next =
              task.empty === true
                ? { ...task, delay: true, empty: true }
                : (({ delay: _drop, ...rest }) => rest)(task)
          }
          return {
            ...g,
            tasks: g.tasks.map((t) => (t.id === task.id ? next : t)),
          }
        }),
      }))
    },
    [updatePlan],
  )

  const removeTask = useCallback(
    (groupId: string, taskId: string) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => ({
          ...g,
          tasks: g.tasks.filter((t) => t.id !== taskId),
        })),
      }))
    },
    [updatePlan],
  )

  const insertTaskAt = useCallback(
    (groupId: string, task: Task, index: number) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => {
          if (g.tasks.some((t) => t.id === task.id)) return g
          const tasks = [...g.tasks]
          const at = Math.max(0, Math.min(index, tasks.length))
          tasks.splice(at, 0, task)
          return { ...g, tasks }
        }),
      }))
    },
    [updatePlan],
  )

  /** Insert an empty "delay" before the current block, or append at the end. */
  const insertGotDelayed = useCallback(
    (groupId: string, now: Date = new Date()): boolean => {
      const group = plan.groups.find((g) => g.id === groupId)
      if (!group) return false
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => applyGotDelayed(g, now)),
      }))
      return true
    },
    [plan.groups, updatePlan],
  )

  const reorderTasks = useCallback(
    (groupId: string, fromIndex: number, toIndex: number) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => {
          if (
            fromIndex === toIndex ||
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= g.tasks.length ||
            toIndex >= g.tasks.length
          ) {
            return g
          }
          const tasks = [...g.tasks]
          const [moved] = tasks.splice(fromIndex, 1)
          if (!moved) return g
          tasks.splice(toIndex, 0, moved)
          return { ...g, tasks }
        }),
      }))
    },
    [updatePlan],
  )

  const setAnchor = useCallback(
    (groupId: string, anchor: StackAnchor) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => ({ ...g, anchor })),
      }))
    },
    [updatePlan],
  )

  const replaceTasks = useCallback(
    (groupId: string, tasks: Task[]) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => ({ ...g, tasks })),
      }))
    },
    [updatePlan],
  )

  const shiftStack = useCallback(
    (groupId: string, deltaMs: number) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => ({
          ...g,
          anchor: shiftAnchor(g.anchor, deltaMs),
        })),
      }))
    },
    [updatePlan],
  )

  const setTaskDuration = useCallback(
    (groupId: string, taskId: string, durationMinutes: number) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => ({
          ...g,
          tasks: g.tasks.map((t) =>
            t.id === taskId
              ? { ...t, durationMinutes: Math.max(1, durationMinutes) }
              : t,
          ),
        })),
      }))
    },
    [updatePlan],
  )

  const clearGroupTasks = useCallback(
    (groupId: string) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => ({
          ...g,
          tasks: [],
        })),
      }))
    },
    [updatePlan],
  )

  const setGroupEnabled = useCallback(
    (groupId: string, enabled: boolean) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => {
          const next: BlockGroup = {
            id: g.id,
            tasks: g.tasks,
            anchor: g.anchor,
            ...(g.name ? { name: g.name } : {}),
            ...(g.color ? { color: g.color } : {}),
            ...(g.checkpoint ? { checkpoint: g.checkpoint } : {}),
            ...(g.intendedEndAt ? { intendedEndAt: g.intendedEndAt } : {}),
            ...(enabled ? {} : { enabled: false }),
          }
          return next
        }),
      }))
    },
    [updatePlan],
  )

  const setGroupName = useCallback(
    (groupId: string, name: string) => {
      const trimmed = name.trim()
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => {
          if (trimmed) return { ...g, name: trimmed }
          const next = { ...g }
          delete next.name
          return next
        }),
      }))
    },
    [updatePlan],
  )

  /** Save the group's current blocks + anchor as the checkpoint to revert to later. */
  const saveCheckpoint = useCallback(
    (groupId: string) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => ({
          ...g,
          checkpoint: createCheckpoint(g.tasks, g.anchor),
        })),
      }))
    },
    [updatePlan],
  )

  /** Replace the group's blocks (and anchor, when saved) with its checkpoint. */
  const revertToCheckpoint = useCallback(
    (groupId: string) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => {
          if (!g.checkpoint) return g
          return {
            ...g,
            tasks: tasksFromCheckpoint(g.checkpoint),
            ...(g.checkpoint.anchor
              ? { anchor: { ...g.checkpoint.anchor } }
              : {}),
          }
        }),
      }))
    },
    [updatePlan],
  )

  /** Directly set (or clear) a group's checkpoint, e.g. to undo a save/revert. */
  const setCheckpoint = useCallback(
    (groupId: string, checkpoint: BlockGroupCheckpoint | undefined) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => {
          if (checkpoint) return { ...g, checkpoint }
          const next = { ...g }
          delete next.checkpoint
          return next
        }),
      }))
    },
    [updatePlan],
  )

  const setGroupColor = useCallback(
    (groupId: string, color: string | undefined) => {
      const trimmed = color?.trim()
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => {
          if (trimmed) return { ...g, color: trimmed }
          const next = { ...g }
          delete next.color
          return next
        }),
      }))
    },
    [updatePlan],
  )

  /** Flip to Starts and capture intended end for execution mode. */
  const beginExecution = useCallback(
    (groupId: string, now: Date = new Date()) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) =>
          prepareGroupForExecution(g, now),
        ),
      }))
    },
    [updatePlan],
  )

  const setIntendedEndAt = useCallback(
    (groupId: string, intendedEndAt: string | undefined) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => {
          if (intendedEndAt) return { ...g, intendedEndAt }
          const next = { ...g }
          delete next.intendedEndAt
          return next
        }),
      }))
    },
    [updatePlan],
  )

  const clearIntendedEndAt = useCallback(
    (groupId: string) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => {
          const hadIntended = Boolean(g.intendedEndAt)
          const hadDone = g.tasks.some((t) => t.done === true)
          if (!hadIntended && !hadDone) return g
          const next = { ...g }
          delete next.intendedEndAt
          if (hadDone) {
            next.tasks = g.tasks.map((t) => {
              if (!t.done) return t
              const { done: _d, ...rest } = t
              return rest
            })
          }
          return next
        }),
      }))
    },
    [updatePlan],
  )

  /** Reset to a blank plan (e.g. on sign-out, before the next account's data loads). */
  const clear = useCallback(() => {
    setPlan(defaultPlan())
  }, [])

  /** Apply a plan pulled from cross-device sync (already normalized). */
  const replacePlan = useCallback((next: Plan) => {
    setPlan(next)
  }, [])

  const findGroupForTask = useCallback(
    (taskId: string): BlockGroup | undefined =>
      plan.groups.find((g) => g.tasks.some((t) => t.id === taskId)),
    [plan.groups],
  )

  return {
    plan,
    addGroup,
    removeGroup,
    duplicateGroup,
    insertGroupAt,
    addGroupFromArchived,
    moveGroup,
    addTask,
    addTasks,
    updateTask,
    removeTask,
    insertTaskAt,
    insertGotDelayed,
    reorderTasks,
    setAnchor,
    replaceTasks,
    shiftStack,
    setTaskDuration,
    clearGroupTasks,
    setGroupEnabled,
    setGroupName,
    setGroupColor,
    saveCheckpoint,
    revertToCheckpoint,
    setCheckpoint,
    beginExecution,
    setIntendedEndAt,
    clearIntendedEndAt,
    clear,
    replacePlan,
    findGroupForTask,
  }
}
