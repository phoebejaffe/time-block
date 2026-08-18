import type { StackAnchor } from './tasks'

/** Allowed scrub / spinner / time-input grids (minutes). */
export const TIME_STEP_MINUTES_OPTIONS = [1, 2, 5, 15] as const
export type TimeStepMinutes = (typeof TIME_STEP_MINUTES_OPTIONS)[number]

/** Synced user preferences (Firestore `users/{uid}.settings`). */
export type UserSettings = {
  /** New plan Starts vs Ends. */
  defaultAnchorKind: 'start' | 'end'
  /** Local wall-clock time for new plans (`HH:mm`). */
  defaultAnchorTime: string
  /** Default duration when adding a Custom block. */
  defaultBlockMinutes: number
  /** Scrub / spinner / time-input grid (minutes). */
  timeStepMinutes: TimeStepMinutes
  /**
   * Everyday undo window in seconds (block delete, delay, archive, …).
   * `0` hides Undo on those toasts.
   */
  quickUndoSeconds: number
  /**
   * Major undo window in seconds (plan delete, checkpoints, folders, …).
   * `0` hides Undo on those toasts.
   */
  majorUndoSeconds: number
  /** Hours after the last active block before a run auto-ends. */
  executionAutoEndHours: number
  /** Google calendar ids omitted from calendars picker + commit modal. */
  hiddenCalendarIds: string[]
  /**
   * Overlay picker checks, synced across devices.
   * `undefined` = not chosen yet (seed from Google selected/primary).
   * `[]` = none shown.
   */
  visibleCalendarIds?: string[]
}

export function defaultUserSettings(): UserSettings {
  return {
    defaultAnchorKind: 'end',
    defaultAnchorTime: '09:00',
    defaultBlockMinutes: 30,
    timeStepMinutes: 5,
    quickUndoSeconds: 5,
    majorUndoSeconds: 10,
    executionAutoEndHours: 2,
    hiddenCalendarIds: [],
  }
}

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function normalizeTimeHHmm(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim())
  if (!m) return fallback
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min)) return fallback
  if (h < 0 || h > 23 || min < 0 || min > 59) return fallback
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function normalizeUserSettings(raw: unknown): UserSettings {
  const d = defaultUserSettings()
  if (!raw || typeof raw !== 'object') return d
  const s = raw as Partial<UserSettings>

  const kind =
    s.defaultAnchorKind === 'start' || s.defaultAnchorKind === 'end'
      ? s.defaultAnchorKind
      : d.defaultAnchorKind

  const step = TIME_STEP_MINUTES_OPTIONS.includes(
    s.timeStepMinutes as TimeStepMinutes,
  )
    ? (s.timeStepMinutes as TimeStepMinutes)
    : d.timeStepMinutes

  const hidden = normalizeIdList(s.hiddenCalendarIds) ?? d.hiddenCalendarIds
  const visible = normalizeIdList(s.visibleCalendarIds)

  return {
    defaultAnchorKind: kind,
    defaultAnchorTime: normalizeTimeHHmm(s.defaultAnchorTime, d.defaultAnchorTime),
    defaultBlockMinutes: clampInt(
      typeof s.defaultBlockMinutes === 'number' ? s.defaultBlockMinutes : d.defaultBlockMinutes,
      1,
      24 * 60,
      d.defaultBlockMinutes,
    ),
    timeStepMinutes: step,
    quickUndoSeconds: clampInt(
      typeof s.quickUndoSeconds === 'number' ? s.quickUndoSeconds : d.quickUndoSeconds,
      0,
      120,
      d.quickUndoSeconds,
    ),
    majorUndoSeconds: clampInt(
      typeof s.majorUndoSeconds === 'number' ? s.majorUndoSeconds : d.majorUndoSeconds,
      0,
      300,
      d.majorUndoSeconds,
    ),
    executionAutoEndHours: clampInt(
      typeof s.executionAutoEndHours === 'number'
        ? s.executionAutoEndHours
        : d.executionAutoEndHours,
      1,
      24,
      d.executionAutoEndHours,
    ),
    hiddenCalendarIds: hidden,
    ...(visible !== undefined ? { visibleCalendarIds: visible } : {}),
  }
}

function normalizeIdList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return [
    ...new Set(
      raw.filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ]
}

export function googleDefaultVisibleCalendarIds(
  list: { id: string; selected?: boolean; primary?: boolean }[],
): string[] {
  const initial = list.filter((c) => c.selected || c.primary).map((c) => c.id)
  if (initial.length === 0 && list[0]) return [list[0].id]
  return initial
}

export function pruneVisibleCalendarIds(
  stored: string[] | undefined,
  availableIds: Iterable<string>,
): string[] | undefined {
  if (!stored) return undefined
  const available = new Set(availableIds)
  return stored.filter((id) => available.has(id))
}

export function sameCalendarIdSet(
  a: Iterable<string>,
  b: Iterable<string>,
): boolean {
  const left = [...a]
  const right = [...b]
  if (left.length !== right.length) return false
  const set = new Set(left)
  return right.every((id) => set.has(id))
}

/** Build today's default stack anchor from settings. */
export function defaultAnchorFromSettings(settings: UserSettings): StackAnchor {
  const [hRaw, mRaw] = settings.defaultAnchorTime.split(':')
  const hours = Number(hRaw)
  const minutes = Number(mRaw)
  const now = new Date()
  const at = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    Number.isFinite(hours) ? hours : 9,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0,
  )
  return { kind: settings.defaultAnchorKind, at: at.toISOString() }
}

export function executionAutoEndAfterMs(settings: UserSettings): number {
  return settings.executionAutoEndHours * 60 * 60 * 1000
}

export function hiddenCalendarIdSet(settings: UserSettings): Set<string> {
  return new Set(settings.hiddenCalendarIds)
}
