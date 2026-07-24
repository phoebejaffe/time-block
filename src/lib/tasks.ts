export type StackAnchor = {
  kind: 'start' | 'end'
  at: string // ISO datetime
}

export type Task = {
  id: string
  title: string
  durationMinutes: number
  /** When true, the block consumes time but is hidden in the UI and skipped on calendar sync. */
  empty?: boolean
}

/** One independent stack of blocks with its own start/end anchor. */
export type BlockGroup = {
  id: string
  tasks: Task[]
  anchor: StackAnchor
  /** Optional label shown when the group is powered off. */
  name?: string
  /** Overlay color for in-app calendar blocks (hex or CSS color). */
  color?: string
  /** When false, the group is collapsed in the sidebar and omitted from the calendar. */
  enabled?: boolean
}

export const DEFAULT_GROUP_COLOR = '#0f6e56'
export const DEFAULT_GROUP_BORDER = '#0b5341'

function darkenHex(hex: string, amount = 0.28): string {
  const raw = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return hex
  const channel = (i: number) => {
    const n = parseInt(raw.slice(i, i + 2), 16)
    return Math.max(0, Math.round(n * (1 - amount)))
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(2)}${channel(4)}`
}

/** Colors for in-app task stack events (not passed to Google Calendar). */
export function groupEventColors(color?: string): {
  backgroundColor: string
  borderColor: string
} {
  const trimmed = color?.trim()
  if (!trimmed) {
    return {
      backgroundColor: DEFAULT_GROUP_COLOR,
      borderColor: DEFAULT_GROUP_BORDER,
    }
  }
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return { backgroundColor: trimmed, borderColor: darkenHex(trimmed) }
  }
  return { backgroundColor: trimmed, borderColor: trimmed }
}

export type Plan = {
  groups: BlockGroup[]
}

export type ResolvedTask = Task & {
  start: Date
  end: Date
}

export type TaskEditPreview = {
  groupId: string
  taskId: string
  title: string
  durationMinutes: number
  empty?: boolean
}

export function isTaskEmpty(task: Pick<Task, 'empty'>): boolean {
  return task.empty === true
}

/** Overlay in-progress sidebar edits onto groups for live calendar preview. */
export function applyTaskEditPreview(
  groups: BlockGroup[],
  preview: TaskEditPreview | null,
): BlockGroup[] {
  if (!preview) return groups
  return groups.map((group) => {
    if (group.id !== preview.groupId) return group
    return {
      ...group,
      tasks: group.tasks.map((task) => {
        if (task.id !== preview.taskId) return task
        const { empty: _removed, ...rest } = task
        return {
          ...rest,
          title: preview.title,
          durationMinutes: preview.durationMinutes,
          ...(preview.empty ? { empty: true } : {}),
        }
      }),
    }
  })
}

function newId(): string {
  return crypto.randomUUID()
}

export function createBlockGroup(
  input?: Partial<
    Pick<BlockGroup, 'tasks' | 'anchor' | 'name' | 'color' | 'enabled'>
  > & {
    id?: string
  },
): BlockGroup {
  return {
    id: input?.id ?? newId(),
    tasks: input?.tasks ?? [],
    anchor: input?.anchor ?? defaultAnchor(),
    ...(input?.name?.trim() ? { name: input.name.trim() } : {}),
    ...(input?.color?.trim() ? { color: input.color.trim() } : {}),
    ...(input?.enabled === false ? { enabled: false } : {}),
  }
}

/** False only when `enabled` is explicitly false. */
export function isGroupEnabled(group: BlockGroup): boolean {
  return group.enabled !== false
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
  return { groups: [createBlockGroup()] }
}

function normalizeTasks(raw: unknown): Task[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (t): t is Task =>
        Boolean(t) &&
        typeof t === 'object' &&
        typeof (t as Task).id === 'string' &&
        typeof (t as Task).title === 'string' &&
        typeof (t as Task).durationMinutes === 'number',
    )
    .map((t) => ({
      id: t.id,
      title: t.title,
      durationMinutes: Math.max(1, Math.round(t.durationMinutes) || 1),
      ...(t.empty === true ? { empty: true } : {}),
    }))
}

function normalizeAnchor(raw: unknown): StackAnchor {
  if (
    raw &&
    typeof raw === 'object' &&
    ((raw as StackAnchor).kind === 'start' ||
      (raw as StackAnchor).kind === 'end') &&
    typeof (raw as StackAnchor).at === 'string'
  ) {
    return {
      kind: (raw as StackAnchor).kind,
      at: (raw as StackAnchor).at,
    }
  }
  return defaultAnchor()
}

function normalizeGroup(raw: unknown): BlockGroup | null {
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Partial<BlockGroup>
  if (typeof g.id !== 'string' || !g.id) return null
  const name =
    typeof g.name === 'string' && g.name.trim() ? g.name.trim() : undefined
  const color =
    typeof g.color === 'string' && g.color.trim() ? g.color.trim() : undefined
  const legacyHidden = (g as { hidden?: boolean }).hidden === true
  const enabled =
    g.enabled === false || (legacyHidden && g.enabled !== true)
      ? false
      : undefined
  return {
    id: g.id,
    tasks: normalizeTasks(g.tasks),
    anchor: normalizeAnchor(g.anchor),
    ...(name ? { name } : {}),
    ...(color ? { color } : {}),
    ...(enabled === false ? { enabled: false } : {}),
  }
}

export function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString()
}

/** HH:mm for `<input type="time">`. */
export function toLocalTimeValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Apply HH:mm onto the date portion of `baseIso`. */
export function fromLocalTimeValue(value: string, baseIso: string): string {
  const base = new Date(baseIso)
  if (Number.isNaN(base.getTime())) return baseIso
  const match = /^(\d{1,2}):(\d{2})/.exec(value)
  if (!match) return baseIso
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return baseIso
  }
  base.setHours(hours, minutes, 0, 0)
  return base.toISOString()
}

/** Normalize stored plan shapes (groups + legacy single stack / Task[]). */
export function migratePlan(raw: unknown): Plan | null {
  if (!raw || typeof raw !== 'object') return null

  // Current shape: { groups: BlockGroup[] }
  if ('groups' in raw && Array.isArray((raw as Plan).groups)) {
    const groups = (raw as Plan).groups
      .map((g) => normalizeGroup(g))
      .filter((g): g is BlockGroup => g != null)
    return { groups: groups.length > 0 ? groups : [createBlockGroup()] }
  }

  // Previous shape: { tasks, anchor } → one group
  if ('tasks' in raw && Array.isArray((raw as { tasks: unknown }).tasks)) {
    const legacy = raw as { tasks: unknown; anchor?: unknown }
    return {
      groups: [
        createBlockGroup({
          tasks: normalizeTasks(legacy.tasks),
          anchor: normalizeAnchor(legacy.anchor),
        }),
      ],
    }
  }

  // Oldest shape: Task[] with optional per-task anchors
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
    return { groups: [createBlockGroup({ tasks, anchor })] }
  }

  return null
}

export function createTask(
  input: Omit<Task, 'id'> & { id?: string },
): Task {
  return {
    id: input.id ?? newId(),
    title: input.title.trim() || 'Untitled',
    durationMinutes: Math.max(1, Math.round(input.durationMinutes) || 1),
    ...(input.empty ? { empty: true } : {}),
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

/** Local midnight for the given calendar day (defaults to today). */
export function startOfLocalDay(date: Date = new Date()): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Pick the day blocks should attach to for a FullCalendar visible range.
 * Prefer today when it falls in the range; otherwise the range start.
 */
export function pickViewDate(
  rangeStart: Date,
  rangeEnd: Date,
  now: Date = new Date(),
): Date {
  if (now >= rangeStart && now < rangeEnd) {
    return startOfLocalDay(now)
  }
  return startOfLocalDay(rangeStart)
}

/** Keep the anchor's clock time; place it on the given local calendar day. */
export function anchorOnDay(anchor: StackAnchor, day: Date): StackAnchor {
  const at = new Date(anchor.at)
  if (Number.isNaN(at.getTime())) return anchor
  const next = startOfLocalDay(day)
  next.setHours(
    at.getHours(),
    at.getMinutes(),
    at.getSeconds(),
    at.getMilliseconds(),
  )
  return { ...anchor, at: next.toISOString() }
}

/** True when the local calendar day of `isoOrDate` is today or tomorrow. */
export function isTodayOrTomorrow(isoOrDate: string | Date): boolean {
  const target =
    typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  if (Number.isNaN(target.getTime())) return true
  const today = startOfLocalDay()
  const tomorrow = startOfLocalDay()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const day = startOfLocalDay(target).getTime()
  return day === today.getTime() || day === tomorrow.getTime()
}

export function localDateKey(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tues', 'Wed', 'Thurs', 'Fri', 'Sat'] as const

export function shortWeekday(date: Date): string {
  return SHORT_WEEKDAYS[date.getDay()]!
}

export function formatLocalDate(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  const month = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(d)
  return `${shortWeekday(d)}, ${month} ${d.getDate()}`
}

export function formatCalendarDay(date: Date): string {
  const month = new Intl.DateTimeFormat(undefined, { month: 'long' }).format(date)
  return `${shortWeekday(date)}, ${month} ${date.getDate()}`
}

export function formatCalendarRange(
  start: Date,
  endExclusive: Date,
  viewType: 'timeGridDay' | 'timeGridThreeDay' | 'timeGridWeek',
): string {
  const last = new Date(endExclusive.getTime() - 1)
  if (viewType === 'timeGridDay') {
    return formatCalendarDay(start)
  }

  const sameMonth =
    start.getFullYear() === last.getFullYear() &&
    start.getMonth() === last.getMonth()

  if (sameMonth) {
    const month = new Intl.DateTimeFormat(undefined, { month: 'long' }).format(start)
    return `${shortWeekday(start)}, ${month} ${start.getDate()} – ${shortWeekday(last)}, ${month} ${last.getDate()}`
  }

  return `${formatCalendarDay(start)} – ${formatCalendarDay(last)}`
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
  tasks: Array<{ title: string; durationMinutes: number; empty?: boolean }>
  updatedAt: string
}

export function normalizeSavedLists(raw: unknown): SavedTaskList[] {
  if (!Array.isArray(raw)) return []
  return raw
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
          ...((t as { empty?: boolean }).empty === true ? { empty: true } : {}),
        })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Save (or overwrite) a list within an existing collection, returning both
 * the updated collection and the saved entry. Pure — callers own where the
 * collection itself is persisted (cross-device sync, in this app's case).
 */
export function upsertSavedList(
  lists: SavedTaskList[],
  name: string,
  tasks: Task[],
  replaceId?: string,
): { lists: SavedTaskList[]; saved: SavedTaskList } {
  const trimmed = name.trim() || 'Untitled list'
  const payload: SavedTaskList = {
    id: replaceId || newId(),
    name: trimmed,
    updatedAt: new Date().toISOString(),
    tasks: tasks.map((t) => ({
      title: t.title,
      durationMinutes: t.durationMinutes,
      ...(t.empty ? { empty: true } : {}),
    })),
  }

  const existingIdx = lists.findIndex(
    (l) => l.id === payload.id || l.name.toLowerCase() === trimmed.toLowerCase(),
  )
  if (existingIdx >= 0) {
    payload.id = lists[existingIdx]!.id
    const next = [...lists]
    next[existingIdx] = payload
    return { lists: next, saved: payload }
  }
  const next = [...lists, payload].sort((a, b) => a.name.localeCompare(b.name))
  return { lists: next, saved: payload }
}

export function removeSavedList(
  lists: SavedTaskList[],
  id: string,
): SavedTaskList[] {
  return lists.filter((l) => l.id !== id)
}

export function tasksFromSavedList(list: SavedTaskList): Task[] {
  return list.tasks.map((t) =>
    createTask({
      title: t.title,
      durationMinutes: t.durationMinutes,
      ...(t.empty ? { empty: true } : {}),
    }),
  )
}

export type SavedBlock = {
  id: string
  title: string
  durationMinutes: number
  empty?: boolean
}

export type BlockLibraryCategory = {
  id: string
  name: string
  blocks: SavedBlock[]
}

export type BlockLibrary = {
  categories: BlockLibraryCategory[]
  updatedAt: string
}

export function createSavedBlock(
  input: Omit<SavedBlock, 'id'> & { id?: string },
): SavedBlock {
  return {
    id: input.id ?? newId(),
    title: input.title.trim() || 'Untitled',
    durationMinutes: Math.max(1, Math.round(input.durationMinutes) || 1),
    ...(input.empty ? { empty: true } : {}),
  }
}

function normalizeSavedBlock(raw: unknown): SavedBlock | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Partial<SavedBlock>
  if (typeof b.id !== 'string' || !b.id) return null
  if (typeof b.title !== 'string') return null
  if (typeof b.durationMinutes !== 'number') return null
  return createSavedBlock({
    id: b.id,
    title: b.title,
    durationMinutes: b.durationMinutes,
    empty: b.empty === true,
  })
}

function normalizeBlockLibraryCategory(raw: unknown): BlockLibraryCategory | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Partial<BlockLibraryCategory>
  if (typeof c.id !== 'string' || !c.id) return null
  if (typeof c.name !== 'string') return null
  if (!Array.isArray(c.blocks)) return null
  const blocks = c.blocks
    .map(normalizeSavedBlock)
    .filter((b): b is SavedBlock => b != null)
  return {
    id: c.id,
    name: c.name.trim() || 'Untitled',
    blocks,
  }
}

export function normalizeBlockLibrary(raw: unknown): BlockLibrary {
  if (!raw || typeof raw !== 'object') {
    return { categories: [], updatedAt: new Date().toISOString() }
  }
  const data = raw as Partial<BlockLibrary>
  if (!Array.isArray(data.categories)) {
    return { categories: [], updatedAt: new Date().toISOString() }
  }
  const categories = data.categories
    .map(normalizeBlockLibraryCategory)
    .filter((c): c is BlockLibraryCategory => c != null)
  return {
    categories,
    updatedAt:
      typeof data.updatedAt === 'string'
        ? data.updatedAt
        : new Date().toISOString(),
  }
}

export function defaultBlockLibrary(): BlockLibrary {
  return {
    categories: [],
    updatedAt: new Date().toISOString(),
  }
}

export function blockLibraryKey(categoryId: string, blockId: string): string {
  return `${categoryId}:${blockId}`
}

export function parseBlockLibraryKey(
  key: string,
): { categoryId: string; blockId: string } | null {
  const idx = key.indexOf(':')
  if (idx <= 0) return null
  return { categoryId: key.slice(0, idx), blockId: key.slice(idx + 1) }
}

export function resolveSavedBlocksFromKeys(
  library: BlockLibrary,
  keys: string[],
): SavedBlock[] {
  const result: SavedBlock[] = []
  for (const key of keys) {
    const parsed = parseBlockLibraryKey(key)
    if (!parsed) continue
    const category = library.categories.find((c) => c.id === parsed.categoryId)
    const block = category?.blocks.find((b) => b.id === parsed.blockId)
    if (block) result.push(block)
  }
  return result
}

export function tasksFromSavedBlocks(blocks: SavedBlock[]): Task[] {
  return blocks.map((b) =>
    createTask({
      title: b.title,
      durationMinutes: b.durationMinutes,
      ...(b.empty ? { empty: true } : {}),
    }),
  )
}

export function touchBlockLibrary(
  categories: BlockLibraryCategory[],
): BlockLibrary {
  return {
    categories,
    updatedAt: new Date().toISOString(),
  }
}
