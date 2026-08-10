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
  /** "I got delayed" spacer. Always empty; never pushed to Google Calendar. */
  delay?: boolean
  /** Finished during execution. Not part of checkpoints; cleared when execution ends. */
  done?: boolean
}

/**
 * A snapshot of a group's blocks, saved as the "default" version the user
 * can always get back to after making one-off adjustments.
 */
export type BlockGroupCheckpoint = {
  tasks: Array<{
    title: string
    durationMinutes: number
    empty?: boolean
    delay?: boolean
  }>
  savedAt: string
  /** Anchor at save time; older checkpoints may omit this. */
  anchor?: StackAnchor
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
  /** Saved "default" block list this group can be reverted to. */
  checkpoint?: BlockGroupCheckpoint
  /**
   * Intended stack end while this group is being executed. Set on enter
   * execution; cleared when execution ends. Not part of checkpoints.
   */
  intendedEndAt?: string
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

function hexToRgb(hex: string): [number, number, number] | null {
  const raw = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null
  return [
    parseInt(raw.slice(0, 2), 16),
    parseInt(raw.slice(2, 4), 16),
    parseInt(raw.slice(4, 6), 16),
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const channel = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

function desaturateHex(hex: string, saturation = 0.5): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const [r, g, b] = rgb
  const gray = 0.299 * r + 0.587 * g + 0.114 * b
  return rgbToHex(
    gray + (r - gray) * saturation,
    gray + (g - gray) * saturation,
    gray + (b - gray) * saturation,
  )
}

/** Mute overlay colors for empty blocks on the in-app calendar. */
export function desaturateEventColors(
  colors: { backgroundColor: string; borderColor: string },
  saturation = 0.5,
): { backgroundColor: string; borderColor: string } {
  return {
    backgroundColor: desaturateHex(colors.backgroundColor, saturation),
    borderColor: desaturateHex(colors.borderColor, saturation),
  }
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

/** Relative luminance 0–1 (WCAG) for contrast checks. */
function hexLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const channel = (n: number) => {
    const s = n / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = rgb.map(channel) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colors (1–21). */
function contrastRatio(a: string, b: string): number | null {
  const la = hexLuminance(a)
  const lb = hexLuminance(b)
  if (la == null || lb == null) return null
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

function mixHex(a: string, b: string, amountA = 0.75): string {
  const rgbA = hexToRgb(a)
  const rgbB = hexToRgb(b)
  if (!rgbA || !rgbB) return a
  const t = Math.max(0, Math.min(1, amountA))
  return rgbToHex(
    rgbA[0] * t + rgbB[0] * (1 - t),
    rgbA[1] * t + rgbB[1] * (1 - t),
    rgbA[2] * t + rgbB[2] * (1 - t),
  )
}

/** Minimum contrast vs white for a thin sidebar accent (WCAG UI/graphic). */
const SIDEBAR_ACCENT_MIN_CONTRAST_VS_WHITE = 3

/**
 * Sidebar left-edge accent: calendar fill when it already reads on white;
 * otherwise a 75/25 mix toward the darker calendar border.
 */
export function groupSidebarAccentColor(color?: string): string {
  const { backgroundColor, borderColor } = groupEventColors(color)
  const vsWhite = contrastRatio(backgroundColor, '#ffffff')
  if (vsWhite == null || vsWhite >= SIDEBAR_ACCENT_MIN_CONTRAST_VS_WHITE) {
    return backgroundColor
  }
  return mixHex(backgroundColor, borderColor, 0.75)
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

export function isTaskDelay(task: Pick<Task, 'delay'>): boolean {
  return task.delay === true
}

/** Format a duration in minutes as "Xh Ym" / "Xh" / "Xm" for compact display. */
export function formatDurationMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const mins = total % 60
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

export function splitDurationMinutes(totalMinutes: number): {
  hours: number
  minutes: number
} {
  const total = Math.max(0, Math.round(totalMinutes))
  return { hours: Math.floor(total / 60), minutes: total % 60 }
}

export function combineDurationMinutes(
  hours: number,
  minutes: number,
): number {
  const h = Math.max(0, Math.round(hours))
  const m = Math.max(0, Math.round(minutes))
  return Math.max(1, h * 60 + m)
}

/** Step total duration by 5 minutes (spinner / arrow keys). */
export function stepDurationMinutes(
  totalMinutes: number,
  direction: 'up' | 'down',
): number {
  const value = Math.max(1, Math.round(totalMinutes))
  if (direction === 'up') {
    if (value % 5 === 0) return value + 5
    return Math.ceil(value / 5) * 5
  }
  if (value % 5 === 0) return Math.max(1, value - 5)
  return Math.max(1, Math.floor(value / 5) * 5)
}

/** Correct native number spinners that nudge by 1 (or mis-step by 5). */
export function applyDurationSpinnerStep(
  prevTotal: number,
  nextTotal: number,
): number {
  const prev = Math.max(1, Math.round(prevTotal))
  const next = Math.max(1, Math.round(nextTotal))
  const delta = next - prev
  if (delta === 0) return prev
  if (
    Math.abs(delta) === 1 ||
    (Math.abs(delta) === 5 && prev % 5 !== 0)
  ) {
    return stepDurationMinutes(prev, delta > 0 ? 'up' : 'down')
  }
  return next
}

/** Overlay in-progress sidebar edits onto groups for live calendar preview. */
export function applyTaskEditPreview(
  groups: BlockGroup[],
  preview: TaskEditPreview | null,
): BlockGroup[] {
  if (!preview) return groups
  return groups.map((group) => {
    if (group.id !== preview.groupId) return group
    const nextTasks = group.tasks.map((task) => {
      if (task.id !== preview.taskId) return task
      const { empty: _e, delay: _d, ...rest } = task
      const keepDelay = isTaskDelay(task) && preview.empty === true
      return {
        ...rest,
        title: preview.title,
        durationMinutes: preview.durationMinutes,
        ...(preview.empty || keepDelay ? { empty: true } : {}),
        ...(keepDelay ? { delay: true } : {}),
      }
    })
    return { ...group, tasks: nextTasks }
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

/** Snapshot the group's current blocks + anchor as a revertible default. */
export function createCheckpoint(
  tasks: Task[],
  anchor: StackAnchor,
): BlockGroupCheckpoint {
  return {
    tasks: tasks.map((t) => ({
      title: t.title,
      durationMinutes: t.durationMinutes,
      ...(t.empty || t.delay ? { empty: true } : {}),
      ...(t.delay ? { delay: true } : {}),
    })),
    savedAt: new Date().toISOString(),
    anchor: { kind: anchor.kind, at: anchor.at },
  }
}

/** Rebuild a fresh task list (new ids) from a saved checkpoint. */
export function tasksFromCheckpoint(checkpoint: BlockGroupCheckpoint): Task[] {
  return checkpoint.tasks.map((t) =>
    createTask({
      title: t.title,
      durationMinutes: t.durationMinutes,
      ...(t.empty || t.delay ? { empty: true } : {}),
      ...(t.delay ? { delay: true } : {}),
    }),
  )
}

/**
 * True when the group's current blocks match its checkpoint — compares
 * title, duration, order, empty-state, and delay flag (not ids or timing).
 */
export function tasksMatchCheckpoint(
  tasks: Task[],
  checkpoint: BlockGroupCheckpoint,
): boolean {
  if (tasks.length !== checkpoint.tasks.length) return false
  return tasks.every((task, i) => {
    const saved = checkpoint.tasks[i]!
    return (
      task.title === saved.title &&
      task.durationMinutes === saved.durationMinutes &&
      isTaskEmpty(task) === (saved.empty === true || saved.delay === true) &&
      isTaskDelay(task) === (saved.delay === true)
    )
  })
}

/**
 * True when the group matches its saved default — tasks plus anchor kind and
 * local clock time. Legacy checkpoints without `anchor` only compare tasks.
 */
export function groupMatchesCheckpoint(
  group: Pick<BlockGroup, 'tasks' | 'anchor'>,
  checkpoint: BlockGroupCheckpoint,
): boolean {
  if (!tasksMatchCheckpoint(group.tasks, checkpoint)) return false
  if (!checkpoint.anchor) return true
  return (
    group.anchor.kind === checkpoint.anchor.kind &&
    toLocalTimeValue(group.anchor.at) ===
      toLocalTimeValue(checkpoint.anchor.at)
  )
}

/**
 * Flip start↔end while shifting `at` by the stack's total duration so the
 * resolved blocks stay on the same calendar times.
 */
export function toggleAnchorPreservingStack(
  anchor: StackAnchor,
  totalDurationMinutes: number,
): StackAnchor {
  const nextKind = anchor.kind === 'start' ? 'end' : 'start'
  const minutes = Math.max(0, Math.round(totalDurationMinutes))
  if (minutes === 0) return { ...anchor, kind: nextKind }
  const at = new Date(anchor.at)
  if (Number.isNaN(at.getTime())) return { ...anchor, kind: nextKind }
  if (anchor.kind === 'start') {
    at.setMinutes(at.getMinutes() + minutes)
  } else {
    at.setMinutes(at.getMinutes() - minutes)
  }
  return { kind: nextKind, at: at.toISOString() }
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
    .map((t) => {
      const delay = t.delay === true
      return {
        id: t.id,
        title: t.title,
        durationMinutes: Math.max(1, Math.round(t.durationMinutes) || 1),
        ...(t.empty === true || delay ? { empty: true } : {}),
        ...(delay ? { delay: true } : {}),
        ...(t.done === true ? { done: true } : {}),
      }
    })
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

function normalizeCheckpoint(raw: unknown): BlockGroupCheckpoint | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const c = raw as Partial<BlockGroupCheckpoint>
  if (!Array.isArray(c.tasks)) return undefined
  const tasks = c.tasks
    .filter(
      (
        t,
      ): t is {
        title: string
        durationMinutes: number
        empty?: boolean
        delay?: boolean
      } =>
        Boolean(t) &&
        typeof t === 'object' &&
        typeof (t as { title?: unknown }).title === 'string' &&
        typeof (t as { durationMinutes?: unknown }).durationMinutes ===
          'number',
    )
    .map((t) => {
      const delay = t.delay === true
      return {
        title: t.title,
        durationMinutes: Math.max(1, Math.round(t.durationMinutes) || 1),
        ...(t.empty === true || delay ? { empty: true } : {}),
        ...(delay ? { delay: true } : {}),
      }
    })
  const anchor =
    c.anchor &&
    typeof c.anchor === 'object' &&
    ((c.anchor as StackAnchor).kind === 'start' ||
      (c.anchor as StackAnchor).kind === 'end') &&
    typeof (c.anchor as StackAnchor).at === 'string'
      ? {
          kind: (c.anchor as StackAnchor).kind,
          at: (c.anchor as StackAnchor).at,
        }
      : undefined
  return {
    tasks,
    savedAt:
      typeof c.savedAt === 'string' ? c.savedAt : new Date().toISOString(),
    ...(anchor ? { anchor } : {}),
  }
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
  const checkpoint = normalizeCheckpoint(g.checkpoint)
  const intendedEndAt =
    typeof g.intendedEndAt === 'string' && g.intendedEndAt
      ? g.intendedEndAt
      : undefined
  return {
    id: g.id,
    tasks: normalizeTasks(g.tasks),
    anchor: normalizeAnchor(g.anchor),
    ...(name ? { name } : {}),
    ...(color ? { color } : {}),
    ...(enabled === false ? { enabled: false } : {}),
    ...(checkpoint ? { checkpoint } : {}),
    ...(intendedEndAt ? { intendedEndAt } : {}),
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
  const delay = input.delay === true
  return {
    id: input.id ?? newId(),
    title: input.title.trim() || 'Untitled',
    durationMinutes: Math.max(1, Math.round(input.durationMinutes) || 1),
    ...(input.empty || delay ? { empty: true } : {}),
    ...(delay ? { delay: true } : {}),
    ...(input.done === true ? { done: true } : {}),
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

/** Round a minute count to the nearest multiple of 5 (0, 5, 10, …). */
export function roundMinutesToNearestFive(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0
  return Math.max(0, Math.round(minutes / 5) * 5)
}

export type GotDelayedPlan =
  | {
      ok: true
      /** Index in `tasks` to insert the delay block before. */
      index: number
      delayMinutes: number
    }
  | { ok: false; reason: 'no-current-block' | 'too-small' }

/**
 * Plan an "I got delayed" insertion: find the block containing `now` (on
 * today's clock for this group's anchor), size an empty "delay" from that
 * block's start to now (nearest 5 minutes). Used in execution mode where
 * the stack is start-anchored, so inserting empty time pushes later blocks
 * later without moving the start.
 *
 * When still within 5 minutes of the current block's start, insert two
 * blocks back instead (before the previous block), sizing the delay from
 * that previous block's start to now — early entry into the next block
 * usually means the prior block ran long.
 */
export function planGotDelayed(
  tasks: Task[],
  anchor: StackAnchor,
  now: Date = new Date(),
): GotDelayedPlan {
  if (tasks.length === 0) return { ok: false, reason: 'no-current-block' }
  const resolved = resolveStack(tasks, anchorOnDay(anchor, now))
  const t = now.getTime()
  const currentIndex = resolved.findIndex(
    (task) => task.start.getTime() <= t && t < task.end.getTime(),
  )
  if (currentIndex < 0) return { ok: false, reason: 'no-current-block' }
  const current = resolved[currentIndex]!
  const elapsedMinutes = (t - current.start.getTime()) / 60_000
  // Still near the start of this block → attribute the delay to the prior one.
  const insertIndex =
    elapsedMinutes < 5 && currentIndex >= 1 ? currentIndex - 1 : currentIndex
  const from = resolved[insertIndex]!
  const delayMinutes = roundMinutesToNearestFive(
    (t - from.start.getTime()) / 60_000,
  )
  if (delayMinutes < 5) return { ok: false, reason: 'too-small' }
  return { ok: true, index: insertIndex, delayMinutes }
}

/** Insert the delay block before the interrupted block. */
export function applyGotDelayed(
  group: BlockGroup,
  now: Date = new Date(),
): BlockGroup | null {
  const planned = planGotDelayed(group.tasks, group.anchor, now)
  if (!planned.ok) return null
  const delay = createTask({
    title: 'Delay',
    durationMinutes: planned.delayMinutes,
    delay: true,
  })
  const tasks = [...group.tasks]
  tasks.splice(planned.index, 0, delay)
  return {
    ...group,
    tasks,
  }
}

/**
 * True when wall-clock `now` is inside this group's stack on today's day, or
 * within one hour before the stack starts — eligibility for "Execute this plan".
 */
export function isGroupExecutableNow(
  group: Pick<BlockGroup, 'tasks' | 'anchor' | 'enabled'>,
  now: Date = new Date(),
): boolean {
  if (group.enabled === false || group.tasks.length === 0) return false
  const resolved = resolveStack(group.tasks, anchorOnDay(group.anchor, now))
  if (resolved.length === 0) return false
  const t = now.getTime()
  const stackStart = resolved[0]!.start.getTime()
  if (t >= stackStart - 60 * 60_000 && t < stackStart) return true
  return resolved.some(
    (task) => task.start.getTime() <= t && t < task.end.getTime(),
  )
}

/**
 * Compare resolved stack end to `intendedEndAt`: late, early, or on time.
 * Uses the group's anchor remapped onto `day` (typically today during execution).
 */
export type StackEndStatus =
  | {
      kind: 'late'
      delayedMinutes: number
      actualEnd: Date
      intendedEnd: Date
    }
  | {
      kind: 'early'
      earlyMinutes: number
      actualEnd: Date
      intendedEnd: Date
    }
  | {
      kind: 'on-time'
      actualEnd: Date
      intendedEnd: Date
    }

export function getStackEndStatus(
  group: Pick<BlockGroup, 'tasks' | 'anchor' | 'intendedEndAt'>,
  day: Date = new Date(),
): StackEndStatus | null {
  if (!group.intendedEndAt) return null
  const intendedEnd = new Date(group.intendedEndAt)
  if (Number.isNaN(intendedEnd.getTime())) return null
  const resolved = resolveStack(group.tasks, anchorOnDay(group.anchor, day))
  const actualEnd = resolved[resolved.length - 1]?.end
  if (!actualEnd) return null
  const deltaMinutes = Math.round(
    (actualEnd.getTime() - intendedEnd.getTime()) / 60_000,
  )
  if (deltaMinutes > 0) {
    return {
      kind: 'late',
      delayedMinutes: deltaMinutes,
      actualEnd,
      intendedEnd,
    }
  }
  if (deltaMinutes < 0) {
    return {
      kind: 'early',
      earlyMinutes: -deltaMinutes,
      actualEnd,
      intendedEnd,
    }
  }
  return { kind: 'on-time', actualEnd, intendedEnd }
}

/**
 * When the resolved stack end is after `intendedEndAt`, return how late we are.
 */
export function getStackDelayOverrun(
  group: Pick<BlockGroup, 'tasks' | 'anchor' | 'intendedEndAt'>,
  day: Date = new Date(),
): {
  delayedMinutes: number
  actualEnd: Date
  intendedEnd: Date
} | null {
  const status = getStackEndStatus(group, day)
  if (!status || status.kind !== 'late') return null
  return {
    delayedMinutes: status.delayedMinutes,
    actualEnd: status.actualEnd,
    intendedEnd: status.intendedEnd,
  }
}

/**
 * Flip a group to start-anchored (preserving stack position) and capture
 * `intendedEndAt` from the resolved end when not already set.
 */
export function prepareGroupForExecution(
  group: BlockGroup,
  now: Date = new Date(),
): BlockGroup {
  const totalMinutes = group.tasks.reduce(
    (sum, task) => sum + task.durationMinutes,
    0,
  )
  const anchor =
    group.anchor.kind === 'start'
      ? group.anchor
      : toggleAnchorPreservingStack(group.anchor, totalMinutes)
  if (group.intendedEndAt) {
    return group.anchor.kind === 'start' ? group : { ...group, anchor }
  }
  const resolved = resolveStack(group.tasks, anchorOnDay(anchor, now))
  const end = resolved[resolved.length - 1]?.end
  return {
    ...group,
    anchor,
    ...(end && !Number.isNaN(end.getTime())
      ? { intendedEndAt: end.toISOString() }
      : {}),
  }
}

/** Local midnight for the given calendar day (defaults to today). */
export function startOfLocalDay(date: Date = new Date()): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Inclusive first/last local calendar days occupied by a group's resolved
 * stack (using the stored anchor, not remapped onto a view day). Empty when
 * there are no tasks or the stack cannot be resolved.
 */
export function stackOccupiedLocalDays(
  group: Pick<BlockGroup, 'tasks' | 'anchor'>,
): { first: Date; last: Date } | null {
  const resolved = resolveStack(group.tasks, group.anchor)
  if (resolved.length === 0) return null
  const first = startOfLocalDay(resolved[0]!.start)
  // Exactly-midnight ends belong to the previous day.
  const last = startOfLocalDay(
    new Date(resolved[resolved.length - 1]!.end.getTime() - 1),
  )
  if (last.getTime() < first.getTime()) return { first, last: first }
  return { first, last }
}

/**
 * Whether shifting a FullCalendar visible range `[start, end)` backward or
 * forward by its own duration would still overlap `bounds` (inclusive local
 * days). Used to disable ‹ › when the next step would leave the stack's days.
 */
export function canNavigateCalendarRange(
  rangeStart: Date,
  rangeEndExclusive: Date,
  bounds: { first: Date; last: Date },
  direction: 'prev' | 'next',
): boolean {
  const durationMs = rangeEndExclusive.getTime() - rangeStart.getTime()
  if (durationMs <= 0) return false
  const delta = direction === 'prev' ? -durationMs : durationMs
  const nextStart = new Date(rangeStart.getTime() + delta)
  const nextEnd = new Date(rangeEndExclusive.getTime() + delta)
  const boundsEnd = startOfLocalDay(bounds.last)
  boundsEnd.setDate(boundsEnd.getDate() + 1)
  return nextStart < boundsEnd && nextEnd > bounds.first
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
    title: input.title.trim(),
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
