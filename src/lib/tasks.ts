export type StackAnchor = {
  kind: 'start' | 'end'
  at: string // ISO datetime
}

export type Task = {
  id: string
  title: string
  durationMinutes: number
}

export type Plan = {
  tasks: Task[]
  anchor: StackAnchor
}

export type ResolvedTask = Task & {
  start: Date
  end: Date
}

const STORAGE_KEY = 'time-blocking.plan'

function newId(): string {
  return crypto.randomUUID()
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Default: ends today at 9:00 local time. */
export function defaultAnchor(): StackAnchor {
  const now = new Date()
  const at = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    9,
    0,
    0,
    0,
  )
  return { kind: 'end', at: at.toISOString() }
}

export function defaultPlan(): Plan {
  return { tasks: [], anchor: defaultAnchor() }
}

export function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString()
}

function migrateLegacy(raw: unknown): Plan | null {
  if (!raw || typeof raw !== 'object') return null

  // New shape: { tasks, anchor }
  if ('tasks' in raw && Array.isArray((raw as Plan).tasks)) {
    const plan = raw as Plan
    const anchor =
      plan.anchor?.kind && plan.anchor?.at
        ? plan.anchor
        : defaultAnchor()
    const tasks = plan.tasks
      .filter(
        (t): t is Task =>
          Boolean(t) &&
          typeof t.id === 'string' &&
          typeof t.title === 'string' &&
          typeof t.durationMinutes === 'number',
      )
      .map((t) => ({
        id: t.id,
        title: t.title,
        durationMinutes: Math.max(1, Math.round(t.durationMinutes) || 1),
      }))
    return { tasks, anchor }
  }

  // Old shape: Task[] with optional per-task anchors
  if (Array.isArray(raw)) {
    const tasks: Task[] = []
    let anchor = defaultAnchor()
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const t = item as {
        id?: string
        title?: string
        durationMinutes?: number
        anchor?: StackAnchor
      }
      if (!t.id || !t.title || typeof t.durationMinutes !== 'number') continue
      tasks.push({
        id: t.id,
        title: t.title,
        durationMinutes: Math.max(1, Math.round(t.durationMinutes) || 1),
      })
      if (t.anchor?.kind && t.anchor?.at) {
        anchor = t.anchor
      }
    }
    return { tasks, anchor }
  }

  return null
}

export function loadPlan(): Plan {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      // Prefer legacy key if present
      const legacy = localStorage.getItem('time-blocking.tasks')
      if (legacy) {
        const migrated = migrateLegacy(JSON.parse(legacy))
        if (migrated) {
          savePlan(migrated)
          localStorage.removeItem('time-blocking.tasks')
          return migrated
        }
      }
      return defaultPlan()
    }
    return migrateLegacy(JSON.parse(raw)) ?? defaultPlan()
  } catch {
    return defaultPlan()
  }
}

export function savePlan(plan: Plan): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plan))
}

export function clearPlan(): void {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem('time-blocking.tasks')
}

const TARGET_CALENDAR_KEY = 'time-blocking.target-calendar'

export function loadTargetCalendarId(): string {
  try {
    return localStorage.getItem(TARGET_CALENDAR_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveTargetCalendarId(id: string): void {
  try {
    if (id) localStorage.setItem(TARGET_CALENDAR_KEY, id)
    else localStorage.removeItem(TARGET_CALENDAR_KEY)
  } catch {
    /* ignore quota / private mode */
  }
}

export function createTask(
  input: Omit<Task, 'id'> & { id?: string },
): Task {
  return {
    id: input.id ?? newId(),
    title: input.title.trim() || 'Untitled',
    durationMinutes: Math.max(1, Math.round(input.durationMinutes) || 1),
  }
}

/**
 * Lay out the ordered task list from a shared start or end anchor.
 * - start: first task begins at `at`, subsequent tasks follow
 * - end: last task finishes at `at`, previous tasks stack backward
 */
export function resolveStack(
  tasks: Task[],
  anchor: StackAnchor,
): ResolvedTask[] {
  if (tasks.length === 0) return []
  const at = new Date(anchor.at)
  if (Number.isNaN(at.getTime())) return []

  if (anchor.kind === 'start') {
    let cursor = at.getTime()
    return tasks.map((task) => {
      const start = new Date(cursor)
      const end = new Date(cursor + task.durationMinutes * 60_000)
      cursor = end.getTime()
      return { ...task, start, end }
    })
  }

  let cursor = at.getTime()
  const resolved: ResolvedTask[] = new Array(tasks.length)
  for (let i = tasks.length - 1; i >= 0; i -= 1) {
    const task = tasks[i]!
    const end = new Date(cursor)
    const start = new Date(cursor - task.durationMinutes * 60_000)
    cursor = start.getTime()
    resolved[i] = { ...task, start, end }
  }
  return resolved
}

export function shiftAnchor(anchor: StackAnchor, deltaMs: number): StackAnchor {
  return {
    ...anchor,
    at: new Date(new Date(anchor.at).getTime() + deltaMs).toISOString(),
  }
}

export function localDateKey(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatLocalDate(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d)
}

const COMMITTED_DAYS_KEY = 'time-blocking.committed-days'

export function loadCommittedDays(): string[] {
  try {
    const raw = localStorage.getItem(COMMITTED_DAYS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((d): d is string => typeof d === 'string')
      : []
  } catch {
    return []
  }
}

export function hasCommittedOnDay(dateKey: string): boolean {
  return loadCommittedDays().includes(dateKey)
}

export function markCommittedDay(dateKey: string): void {
  if (!dateKey) return
  const days = new Set(loadCommittedDays())
  days.add(dateKey)
  localStorage.setItem(COMMITTED_DAYS_KEY, JSON.stringify([...days]))
}

export type SavedTaskList = {
  id: string
  name: string
  tasks: Array<{ title: string; durationMinutes: number }>
  updatedAt: string
}

const SAVED_LISTS_KEY = 'time-blocking.saved-lists'

export function loadSavedLists(): SavedTaskList[] {
  try {
    const raw = localStorage.getItem(SAVED_LISTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is SavedTaskList =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as SavedTaskList).id === 'string' &&
          typeof (item as SavedTaskList).name === 'string' &&
          Array.isArray((item as SavedTaskList).tasks),
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        updatedAt: item.updatedAt || new Date().toISOString(),
        tasks: item.tasks
          .filter(
            (t) =>
              t &&
              typeof t.title === 'string' &&
              typeof t.durationMinutes === 'number',
          )
          .map((t) => ({
            title: t.title,
            durationMinutes: Math.max(1, Math.round(t.durationMinutes) || 1),
          })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

function writeSavedLists(lists: SavedTaskList[]): void {
  localStorage.setItem(SAVED_LISTS_KEY, JSON.stringify(lists))
}

export function saveTaskList(
  name: string,
  tasks: Task[],
  replaceId?: string,
): SavedTaskList {
  const trimmed = name.trim() || 'Untitled list'
  const lists = loadSavedLists()
  const payload: SavedTaskList = {
    id: replaceId || newId(),
    name: trimmed,
    updatedAt: new Date().toISOString(),
    tasks: tasks.map((t) => ({
      title: t.title,
      durationMinutes: t.durationMinutes,
    })),
  }

  const existingIdx = lists.findIndex(
    (l) => l.id === payload.id || l.name.toLowerCase() === trimmed.toLowerCase(),
  )
  if (existingIdx >= 0) {
    payload.id = lists[existingIdx]!.id
    lists[existingIdx] = payload
  } else {
    lists.push(payload)
  }
  writeSavedLists(lists)
  return payload
}

export function deleteSavedList(id: string): void {
  writeSavedLists(loadSavedLists().filter((l) => l.id !== id))
}

export function tasksFromSavedList(list: SavedTaskList): Task[] {
  return list.tasks.map((t) =>
    createTask({ title: t.title, durationMinutes: t.durationMinutes }),
  )
}
