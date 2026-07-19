import { useCallback, useEffect, useState } from 'react'
import {
  clearPlan as clearStoredPlan,
  createBlockGroup,
  createTask,
  defaultPlan,
  loadPlan,
  savePlan,
  shiftAnchor,
  type BlockGroup,
  type Plan,
  type StackAnchor,
  type Task,
} from '../lib/tasks'

function mapGroup(
  groups: BlockGroup[],
  groupId: string,
  update: (group: BlockGroup) => BlockGroup,
): BlockGroup[] {
  return groups.map((g) => (g.id === groupId ? update(g) : g))
}

export function usePlan() {
  const [plan, setPlan] = useState<Plan>(() => loadPlan())

  useEffect(() => {
    savePlan(plan)
  }, [plan])

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

  const updateTask = useCallback(
    (groupId: string, task: Task) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => ({
          ...g,
          tasks: g.tasks.map((t) => (t.id === task.id ? task : t)),
        })),
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

  const addFromSlot = useCallback(
    (groupId: string, start: Date, end: Date) => {
      const durationMinutes = Math.max(
        1,
        Math.round((end.getTime() - start.getTime()) / 60_000),
      )
      addTask(groupId, { title: 'New block', durationMinutes })
    },
    [addTask],
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

  const setGroupHidden = useCallback(
    (groupId: string, hidden: boolean, name?: string) => {
      updatePlan((prev) => ({
        groups: mapGroup(prev.groups, groupId, (g) => {
          const nextName =
            name !== undefined
              ? name.trim() || undefined
              : g.name
          const next: BlockGroup = {
            id: g.id,
            tasks: g.tasks,
            anchor: g.anchor,
            ...(nextName ? { name: nextName } : {}),
            ...(hidden ? { hidden: true } : {}),
          }
          return next
        }),
      }))
    },
    [updatePlan],
  )

  const clear = useCallback(() => {
    clearStoredPlan()
    setPlan(defaultPlan())
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
    addTask,
    updateTask,
    removeTask,
    insertTaskAt,
    reorderTasks,
    setAnchor,
    replaceTasks,
    shiftStack,
    setTaskDuration,
    addFromSlot,
    clearGroupTasks,
    setGroupHidden,
    clear,
    findGroupForTask,
  }
}
