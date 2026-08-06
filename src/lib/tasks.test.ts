import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  anchorOnDay,
  blockLibraryKey,
  createCheckpoint,
  defaultBlockLibrary,
  formatCalendarDay,
  formatCalendarRange,
  applyDurationSpinnerStep,
  combineDurationMinutes,
  formatDurationMinutes,
  splitDurationMinutes,
  stepDurationMinutes,
  groupEventColors,
  groupSidebarAccentColor,
  hasCommittedOnDay,
  loadCommittedDays,
  localDateKey,
  markCommittedDay,
  migratePlan,
  normalizeBlockLibrary,
  pickViewDate,
  resolveSavedBlocksFromKeys,
  resolveStack,
  shortWeekday,
  startOfLocalDay,
  tasksFromCheckpoint,
  tasksFromSavedBlocks,
  tasksMatchCheckpoint,
  type BlockLibrary,
  type StackAnchor,
  type Task,
} from './tasks'

const tasks: Task[] = [
  { id: 'a', title: 'A', durationMinutes: 30 },
  { id: 'b', title: 'B', durationMinutes: 15 },
  { id: 'c', title: 'C', durationMinutes: 45 },
]

describe('resolveStack', () => {
  it('stacks forward from a start anchor', () => {
    const anchor: StackAnchor = {
      kind: 'start',
      at: '2026-07-18T09:00:00.000Z',
    }
    const resolved = resolveStack(tasks, anchor)
    expect(resolved).toHaveLength(3)
    expect(resolved[0]!.start.toISOString()).toBe('2026-07-18T09:00:00.000Z')
    expect(resolved[0]!.end.toISOString()).toBe('2026-07-18T09:30:00.000Z')
    expect(resolved[1]!.start.toISOString()).toBe('2026-07-18T09:30:00.000Z')
    expect(resolved[1]!.end.toISOString()).toBe('2026-07-18T09:45:00.000Z')
    expect(resolved[2]!.start.toISOString()).toBe('2026-07-18T09:45:00.000Z')
    expect(resolved[2]!.end.toISOString()).toBe('2026-07-18T10:30:00.000Z')
  })

  it('stacks backward from an end anchor', () => {
    const anchor: StackAnchor = {
      kind: 'end',
      at: '2026-07-18T10:30:00.000Z',
    }
    const resolved = resolveStack(tasks, anchor)
    expect(resolved[2]!.end.toISOString()).toBe('2026-07-18T10:30:00.000Z')
    expect(resolved[2]!.start.toISOString()).toBe('2026-07-18T09:45:00.000Z')
    expect(resolved[0]!.start.toISOString()).toBe('2026-07-18T09:00:00.000Z')
    expect(resolved[0]!.end.toISOString()).toBe('2026-07-18T09:30:00.000Z')
  })

  it('reassigns times when task order changes under the same anchor', () => {
    const anchor: StackAnchor = {
      kind: 'start',
      at: '2026-07-18T09:00:00.000Z',
    }
    const original = resolveStack(tasks, anchor)
    const reordered = resolveStack([tasks[1]!, tasks[0]!, tasks[2]!], anchor)

    expect(reordered.map((task) => task.id)).toEqual(['b', 'a', 'c'])
    expect(reordered[0]!.start.toISOString()).toBe('2026-07-18T09:00:00.000Z')
    expect(reordered[1]!.start.toISOString()).toBe('2026-07-18T09:15:00.000Z')
    expect(original[1]!.start.toISOString()).toBe('2026-07-18T09:30:00.000Z')
  })

  it('returns empty for no tasks or invalid anchor', () => {
    expect(resolveStack([], { kind: 'start', at: '2026-07-18T09:00:00.000Z' })).toEqual(
      [],
    )
    expect(
      resolveStack(tasks, { kind: 'end', at: 'not-a-date' }),
    ).toEqual([])
  })

  it('empty blocks consume time so the next block starts at their end', () => {
    const withEmpty: Task[] = [
      { id: 'a', title: 'A', durationMinutes: 30 },
      { id: 'gap', title: 'Gap', durationMinutes: 15, empty: true },
      { id: 'b', title: 'B', durationMinutes: 45 },
    ]
    const anchor: StackAnchor = {
      kind: 'start',
      at: '2026-07-18T09:00:00.000Z',
    }
    const resolved = resolveStack(withEmpty, anchor)
    expect(resolved[1]!.empty).toBe(true)
    expect(resolved[1]!.start.toISOString()).toBe('2026-07-18T09:30:00.000Z')
    expect(resolved[1]!.end.toISOString()).toBe('2026-07-18T09:45:00.000Z')
    expect(resolved[2]!.start.toISOString()).toBe('2026-07-18T09:45:00.000Z')
  })
})

describe('anchorOnDay', () => {
  it('keeps clock time and moves it onto another local day', () => {
    const anchor: StackAnchor = {
      kind: 'end',
      at: new Date(2026, 6, 18, 9, 30, 0, 0).toISOString(),
    }
    const next = anchorOnDay(anchor, new Date(2026, 6, 20))
    const d = new Date(next.at)
    expect(next.kind).toBe('end')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(6)
    expect(d.getDate()).toBe(20)
    expect(d.getHours()).toBe(9)
    expect(d.getMinutes()).toBe(30)
  })
})

describe('pickViewDate', () => {
  it('uses today when it falls in the visible range', () => {
    const start = new Date(2026, 6, 13)
    const end = new Date(2026, 6, 20)
    const now = new Date(2026, 6, 15, 14, 0)
    expect(pickViewDate(start, end, now).getTime()).toBe(
      startOfLocalDay(now).getTime(),
    )
  })

  it('uses the range start when today is outside the range', () => {
    const start = new Date(2026, 6, 20)
    const end = new Date(2026, 6, 21)
    const now = new Date(2026, 6, 15, 14, 0)
    expect(pickViewDate(start, end, now).getTime()).toBe(
      startOfLocalDay(start).getTime(),
    )
  })
})

describe('migratePlan', () => {
  it('keeps the current { groups } shape', () => {
    const plan = migratePlan({
      groups: [
        {
          id: 'g1',
          color: '#336699',
          tasks: [
            { id: '1', title: 'Write', durationMinutes: 25 },
            { id: 'x', title: 'bad' },
          ],
          anchor: { kind: 'start', at: '2026-07-18T08:00:00.000Z' },
        },
      ],
    })
    expect(plan).not.toBeNull()
    expect(plan!.groups).toHaveLength(1)
    expect(plan!.groups[0]!.id).toBe('g1')
    expect(plan!.groups[0]!.color).toBe('#336699')
    expect(plan!.groups[0]!.tasks).toEqual([
      { id: '1', title: 'Write', durationMinutes: 25 },
    ])
    expect(plan!.groups[0]!.anchor).toEqual({
      kind: 'start',
      at: '2026-07-18T08:00:00.000Z',
    })
  })

  it('preserves empty blocks when loading a plan', () => {
    const plan = migratePlan({
      groups: [
        {
          id: 'g1',
          tasks: [{ id: '1', title: 'Gap', durationMinutes: 10, empty: true }],
          anchor: { kind: 'start', at: '2026-07-18T08:00:00.000Z' },
        },
      ],
    })
    expect(plan!.groups[0]!.tasks[0]).toEqual({
      id: '1',
      title: 'Gap',
      durationMinutes: 10,
      empty: true,
    })
  })

  it('migrates previous { tasks, anchor } into one group', () => {
    const plan = migratePlan({
      tasks: [{ id: '1', title: 'Write', durationMinutes: 25 }],
      anchor: { kind: 'start', at: '2026-07-18T08:00:00.000Z' },
    })
    expect(plan!.groups).toHaveLength(1)
    expect(plan!.groups[0]!.tasks).toEqual([
      { id: '1', title: 'Write', durationMinutes: 25 },
    ])
    expect(plan!.groups[0]!.anchor).toEqual({
      kind: 'start',
      at: '2026-07-18T08:00:00.000Z',
    })
  })

  it('migrates legacy Task[] with a per-task anchor', () => {
    const plan = migratePlan([
      {
        id: '1',
        title: 'Old',
        durationMinutes: 10.4,
        anchor: { kind: 'end', at: '2026-07-18T09:00:00.000Z' },
      },
    ])
    expect(plan!.groups[0]!.tasks).toEqual([
      { id: '1', title: 'Old', durationMinutes: 10 },
    ])
    expect(plan!.groups[0]!.anchor.kind).toBe('end')
    expect(plan!.groups[0]!.anchor.at).toBe('2026-07-18T09:00:00.000Z')
  })

  it('returns null for unrecognized payloads', () => {
    expect(migratePlan(null)).toBeNull()
    expect(migratePlan('nope')).toBeNull()
    expect(migratePlan({ foo: 1 })).toBeNull()
  })

  it('clamps invalid durations to at least 1', () => {
    const plan = migratePlan({
      tasks: [{ id: '1', title: 'Tiny', durationMinutes: 0 }],
      anchor: { kind: 'end', at: '2026-07-18T09:00:00.000Z' },
    })
    expect(plan!.groups[0]!.tasks[0]!.durationMinutes).toBe(1)
  })

  it('migrates legacy hidden groups to enabled: false', () => {
    const plan = migratePlan({
      groups: [
        {
          id: 'g1',
          tasks: [{ id: '1', title: 'Write', durationMinutes: 25 }],
          anchor: { kind: 'start', at: '2026-07-18T08:00:00.000Z' },
          hidden: true,
        },
      ],
    })
    expect(plan!.groups[0]!.enabled).toBe(false)
    expect(plan!.groups[0]).not.toHaveProperty('hidden')
  })
})

describe('groupEventColors', () => {
  it('returns default colors when no custom color is set', () => {
    expect(groupEventColors()).toEqual({
      backgroundColor: '#0f6e56',
      borderColor: '#0b5341',
    })
  })

  it('derives a darker border from hex group colors', () => {
    expect(groupEventColors('#336699').backgroundColor).toBe('#336699')
    expect(groupEventColors('#336699').borderColor).toBe('#25496e')
  })
})

describe('groupSidebarAccentColor', () => {
  it('keeps fills that already contrast enough against white', () => {
    expect(groupSidebarAccentColor('#0f6e56')).toBe('#0f6e56')
    expect(groupSidebarAccentColor('#336699')).toBe('#336699')
  })

  it('nudges low-contrast-on-white fills toward the darker border', () => {
    const yellow = '#f5e663'
    const accent = groupSidebarAccentColor(yellow)
    expect(accent).not.toBe(yellow)
    expect(accent).not.toBe(groupEventColors(yellow).borderColor)
  })
})

describe('splitDurationMinutes', () => {
  it('splits total minutes into hours and minutes', () => {
    expect(splitDurationMinutes(135)).toEqual({ hours: 2, minutes: 15 })
    expect(splitDurationMinutes(45)).toEqual({ hours: 0, minutes: 45 })
    expect(splitDurationMinutes(60)).toEqual({ hours: 1, minutes: 0 })
  })
})

describe('combineDurationMinutes', () => {
  it('combines hours and minutes with a minimum of 1', () => {
    expect(combineDurationMinutes(2, 15)).toBe(135)
    expect(combineDurationMinutes(0, 0)).toBe(1)
  })
})

describe('stepDurationMinutes', () => {
  it('steps up to the next 5-minute mark', () => {
    expect(stepDurationMinutes(30, 'up')).toBe(35)
    expect(stepDurationMinutes(32, 'up')).toBe(35)
  })

  it('steps down to the previous 5-minute mark', () => {
    expect(stepDurationMinutes(35, 'down')).toBe(30)
    expect(stepDurationMinutes(32, 'down')).toBe(30)
  })
})

describe('applyDurationSpinnerStep', () => {
  it('corrects native +1 spinner clicks to the 5-minute grid', () => {
    expect(applyDurationSpinnerStep(30, 31)).toBe(35)
    expect(applyDurationSpinnerStep(32, 33)).toBe(35)
    expect(applyDurationSpinnerStep(35, 34)).toBe(30)
  })

  it('preserves manually typed values', () => {
    expect(applyDurationSpinnerStep(30, 47)).toBe(47)
  })
})

describe('formatDurationMinutes', () => {
  it('formats sub-hour durations as minutes only', () => {
    expect(formatDurationMinutes(0)).toBe('0m')
    expect(formatDurationMinutes(45)).toBe('45m')
  })

  it('formats exact-hour durations without a minutes part', () => {
    expect(formatDurationMinutes(60)).toBe('1h')
    expect(formatDurationMinutes(180)).toBe('3h')
  })

  it('formats mixed hour and minute durations', () => {
    expect(formatDurationMinutes(135)).toBe('2h 15m')
  })

  it('rounds and clamps to non-negative values', () => {
    expect(formatDurationMinutes(59.6)).toBe('1h')
    expect(formatDurationMinutes(-10)).toBe('0m')
  })
})

describe('calendar date labels', () => {
  it('uses custom short weekday names without year', () => {
    const date = new Date(2026, 6, 24)
    expect(shortWeekday(date)).toBe('Fri')
    expect(formatCalendarDay(date)).toBe('Fri, July 24')
    expect(
      formatCalendarRange(
        new Date(2026, 6, 20),
        new Date(2026, 6, 23),
        'timeGridThreeDay',
      ),
    ).toBe('Mon, July 20 – Wed, July 22')
  })
})

describe('block library', () => {
  it('starts with no default categories', () => {
    const library = defaultBlockLibrary()
    expect(library.categories).toEqual([])
  })

  it('resolves blocks from click-order keys', () => {
    const library: BlockLibrary = {
      updatedAt: new Date().toISOString(),
      categories: [
        {
          id: 'cat-a',
          name: 'Routine',
          blocks: [
            { id: 'b1', title: 'Wake', durationMinutes: 5 },
            { id: 'b2', title: 'Shower', durationMinutes: 15 },
          ],
        },
      ],
    }
    const keys = [
      blockLibraryKey('cat-a', 'b1'),
      blockLibraryKey('cat-a', 'b2'),
    ]
    const blocks = resolveSavedBlocksFromKeys(library, keys)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.title).toBe('Wake')
    expect(blocks[1]!.title).toBe('Shower')
  })

  it('preserves empty flag when creating tasks from saved blocks', () => {
    const tasks = tasksFromSavedBlocks([
      {
        id: 'b1',
        title: 'Gap',
        durationMinutes: 10,
        empty: true,
      },
    ])
    expect(tasks[0]!.empty).toBe(true)
  })

  it('normalizes invalid library payloads to empty categories', () => {
    expect(normalizeBlockLibrary(null).categories).toEqual([])
    expect(normalizeBlockLibrary({ categories: 'nope' }).categories).toEqual([])
  })
})

describe('checkpoints', () => {
  it('matches when tasks are identical in title/duration/order/empty', () => {
    const checkpoint = createCheckpoint(tasks)
    expect(tasksMatchCheckpoint(tasks, checkpoint)).toBe(true)
  })

  it('detects drift from an edited title, duration, reorder, or added/removed task', () => {
    const checkpoint = createCheckpoint(tasks)
    expect(
      tasksMatchCheckpoint(
        [{ ...tasks[0]!, title: 'Changed' }, tasks[1]!, tasks[2]!],
        checkpoint,
      ),
    ).toBe(false)
    expect(
      tasksMatchCheckpoint(
        [{ ...tasks[0]!, durationMinutes: 99 }, tasks[1]!, tasks[2]!],
        checkpoint,
      ),
    ).toBe(false)
    expect(
      tasksMatchCheckpoint([tasks[1]!, tasks[0]!, tasks[2]!], checkpoint),
    ).toBe(false)
    expect(tasksMatchCheckpoint([tasks[0]!, tasks[1]!], checkpoint)).toBe(
      false,
    )
  })

  it('ignores ids when comparing, so re-saving after a revert still matches', () => {
    const checkpoint = createCheckpoint(tasks)
    const rebuilt = tasksFromCheckpoint(checkpoint)
    expect(rebuilt.map((t) => t.id)).not.toEqual(tasks.map((t) => t.id))
    expect(tasksMatchCheckpoint(rebuilt, checkpoint)).toBe(true)
  })

  it('preserves empty blocks through save and restore', () => {
    const withEmpty: Task[] = [
      { id: 'a', title: 'A', durationMinutes: 30 },
      { id: 'gap', title: 'Gap', durationMinutes: 15, empty: true },
    ]
    const checkpoint = createCheckpoint(withEmpty)
    const rebuilt = tasksFromCheckpoint(checkpoint)
    expect(rebuilt[1]!.empty).toBe(true)
    expect(tasksMatchCheckpoint(withEmpty, checkpoint)).toBe(true)
  })
})

describe('commit-day keying', () => {
  const COMMITTED_DAYS_KEY = 'time-blocking.committed-days'
  let store: Map<string, string>

  beforeEach(() => {
    store = new Map()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value)
        },
        removeItem: (key: string) => {
          store.delete(key)
        },
        clear: () => {
          store.clear()
        },
      },
    })
  })

  afterEach(() => {
    store.clear()
  })

  it('keys by local calendar date', () => {
    const d = new Date(2026, 6, 18, 23, 30, 0)
    expect(localDateKey(d)).toBe('2026-07-18')
    expect(localDateKey('not-a-date')).toBe('')
  })

  it('tracks committed days in localStorage', () => {
    expect(hasCommittedOnDay('2026-07-18')).toBe(false)
    markCommittedDay('2026-07-18')
    markCommittedDay('2026-07-18')
    markCommittedDay('')
    expect(hasCommittedOnDay('2026-07-18')).toBe(true)
    expect(loadCommittedDays()).toEqual(['2026-07-18'])
    expect(store.get(COMMITTED_DAYS_KEY)).toBe(
      JSON.stringify(['2026-07-18']),
    )
  })
})
