import { useCallback, useEffect, useState } from 'react'
import {
  clearPlan as clearStoredPlan,
  createTask,
  defaultPlan,
  loadPlan,
  savePlan,
  shiftAnchor,
  type Plan,
  type StackAnchor,
  type Task,
} from '../lib/tasks'

export function usePlan() {
  const [plan, setPlan] = useState<Plan>(() => loadPlan())

  useEffect(() => {
    savePlan(plan)
  }, [plan])

  const updatePlan = useCallback((updater: (prev: Plan) => Plan) => {
    setPlan((prev) => updater(prev))
  }, [])

  const addTask = useCallback(
    (input: Omit<Task, 'id'>) => {
      updatePlan((prev) => ({
        ...prev,
        tasks: [...prev.tasks, createTask(input)],
      }))
    },
    [updatePlan],
  )

  const updateTask = useCallback(
    (task: Task) => {
      updatePlan((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === task.id ? task : t)),
      }))
    },
    [updatePlan],
  )

  const removeTask = useCallback(
    (id: string) => {
      updatePlan((prev) => ({
        ...prev,
        tasks: prev.tasks.filter((t) => t.id !== id),
      }))
    },
    [updatePlan],
  )

  const reorderTasks = useCallback(
    (fromIndex: number, toIndex: number) => {
      updatePlan((prev) => {
        if (
          fromIndex === toIndex ||
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= prev.tasks.length ||
          toIndex >= prev.tasks.length
        ) {
          return prev
        }
        const tasks = [...prev.tasks]
        const [moved] = tasks.splice(fromIndex, 1)
        if (!moved) return prev
        tasks.splice(toIndex, 0, moved)
        return { ...prev, tasks }
      })
    },
    [updatePlan],
  )

  const setAnchor = useCallback(
    (anchor: StackAnchor) => {
      updatePlan((prev) => ({ ...prev, anchor }))
    },
    [updatePlan],
  )

  const replaceTasks = useCallback(
    (tasks: Task[]) => {
      updatePlan((prev) => ({ ...prev, tasks }))
    },
    [updatePlan],
  )

  const shiftStack = useCallback(
    (deltaMs: number) => {
      updatePlan((prev) => ({
        ...prev,
        anchor: shiftAnchor(prev.anchor, deltaMs),
      }))
    },
    [updatePlan],
  )

  const setTaskDuration = useCallback(
    (taskId: string, durationMinutes: number) => {
      updatePlan((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === taskId
            ? { ...t, durationMinutes: Math.max(1, durationMinutes) }
            : t,
        ),
      }))
    },
    [updatePlan],
  )

  const addFromSlot = useCallback(
    (start: Date, end: Date) => {
      const durationMinutes = Math.max(
        1,
        Math.round((end.getTime() - start.getTime()) / 60_000),
      )
      addTask({ title: 'New block', durationMinutes })
    },
    [addTask],
  )

  const clear = useCallback(() => {
    clearStoredPlan()
    setPlan(defaultPlan())
  }, [])

  return {
    plan,
    addTask,
    updateTask,
    removeTask,
    reorderTasks,
    setAnchor,
    replaceTasks,
    shiftStack,
    setTaskDuration,
    addFromSlot,
    clear,
  }
}
