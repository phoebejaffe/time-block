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
  stepLocalTime,
  groupEventColors,
  groupMatchesCheckpoint,
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
  applyGotDelayed,
  planGotDelayed,
  toggleAnchorPreservingStack,
  isGroupExecutableNow,
  shouldAutoEndExecution,
  getStackDelayOverrun,
  getStackEndStatus,
  prepareGroupForExecution,
  stackOccupiedLocalDays,
  canNavigateCalendarRange,
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

  it('disabled blocks consume no time so neighbors abut', () => {
    const withDisabled: Task[] = [
      { id: 'a', title: 'A', durationMinutes: 30 },
      { id: 'skip', title: 'Skip', durationMinutes: 45, disabled: true },
      { id: 'b', title: 'B', durationMinutes: 15 },
    ]
    const startAnchor: StackAnchor = {
      kind: 'start',
      at: '2026-07-18T09:00:00.000Z',
    }
    const forward = resolveStack(withDisabled, startAnchor)
    expect(forward[1]!.disabled).toBe(true)
    expect(forward[1]!.start.toISOString()).toBe(forward[1]!.end.toISOString())
    expect(forward[1]!.start.toISOString()).toBe('2026-07-18T09:30:00.000Z')
    expect(forward[2]!.start.toISOString()).toBe('2026-07-18T09:30:00.000Z')
    expect(forward[2]!.end.toISOString()).toBe('2026-07-18T09:45:00.000Z')

    const endAnchor: StackAnchor = {
      kind: 'end',
      at: '2026-07-18T09:45:00.000Z',
    }
    const backward = resolveStack(withDisabled, endAnchor)
    expect(backward[0]!.start.toISOString()).toBe('2026-07-18T09:00:00.000Z')
    expect(backward[2]!.end.toISOString()).toBe('2026-07-18T09:45:00.000Z')
    expect(backward[1]!.start.toISOString()).toBe(
      backward[1]!.end.toISOString(),
    )
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

  it('preserves calendar guests when loading a plan', () => {
    const plan = migratePlan({
      groups: [
        {
          id: 'g1',
          tasks: [{ id: '1', title: 'Write', durationMinutes: 25 }],
          anchor: { kind: 'start', at: '2026-07-18T08:00:00.000Z' },
          calendarGuests: {
            'cal-1': [{ email: 'ada@example.com', name: 'Ada' }],
          },
        },
      ],
    })
    expect(plan!.groups[0]!.calendarGuests).toEqual({
      'cal-1': [{ email: 'ada@example.com', name: 'Ada' }],
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

  it('preserves disabled blocks when loading a plan', () => {
    const plan = migratePlan({
      groups: [
        {
          id: 'g1',
          tasks: [
            { id: '1', title: 'Skip', durationMinutes: 10, disabled: true },
          ],
          anchor: { kind: 'start', at: '2026-07-18T08:00:00.000Z' },
        },
      ],
    })
    expect(plan!.groups[0]!.tasks[0]).toEqual({
      id: '1',
      title: 'Skip',
      durationMinutes: 10,
      disabled: true,
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

describe('stepLocalTime', () => {
  it('rolls the hour when minutes step down through :00', () => {
    const at = new Date(2026, 7, 10, 10, 0).toISOString()
    const next = new Date(stepLocalTime(at, 'minute', -1))
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(55)
  })

  it('rolls the hour when minutes step up through :55', () => {
    const at = new Date(2026, 7, 10, 10, 55).toISOString()
    const next = new Date(stepLocalTime(at, 'minute', 1))
    expect(next.getHours()).toBe(11)
    expect(next.getMinutes()).toBe(0)
  })

  it('snaps off-grid minutes toward the step direction', () => {
    const at = new Date(2026, 7, 10, 10, 3).toISOString()
    const down = new Date(stepLocalTime(at, 'minute', -1))
    expect(down.getHours()).toBe(10)
    expect(down.getMinutes()).toBe(0)
    const up = new Date(stepLocalTime(at, 'minute', 1))
    expect(up.getHours()).toBe(10)
    expect(up.getMinutes()).toBe(5)
  })

  it('steps hours without changing minutes', () => {
    const at = new Date(2026, 7, 10, 10, 30).toISOString()
    const next = new Date(stepLocalTime(at, 'hour', -1))
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(30)
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
  const anchor: StackAnchor = {
    kind: 'end',
    at: '2026-07-18T17:00:00.000Z',
  }

  it('matches when tasks are identical in title/duration/order/empty', () => {
    const checkpoint = createCheckpoint(tasks, anchor)
    expect(tasksMatchCheckpoint(tasks, checkpoint)).toBe(true)
  })

  it('detects drift from an edited title, duration, reorder, or added/removed task', () => {
    const checkpoint = createCheckpoint(tasks, anchor)
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
    const checkpoint = createCheckpoint(tasks, anchor)
    const rebuilt = tasksFromCheckpoint(checkpoint)
    expect(rebuilt.map((t) => t.id)).not.toEqual(tasks.map((t) => t.id))
    expect(tasksMatchCheckpoint(rebuilt, checkpoint)).toBe(true)
  })

  it('preserves empty blocks through save and restore', () => {
    const withEmpty: Task[] = [
      { id: 'a', title: 'A', durationMinutes: 30 },
      { id: 'gap', title: 'Gap', durationMinutes: 15, empty: true },
    ]
    const checkpoint = createCheckpoint(withEmpty, anchor)
    const rebuilt = tasksFromCheckpoint(checkpoint)
    expect(rebuilt[1]!.empty).toBe(true)
    expect(tasksMatchCheckpoint(withEmpty, checkpoint)).toBe(true)
  })

  it('preserves disabled blocks through save and restore', () => {
    const withDisabled: Task[] = [
      { id: 'a', title: 'A', durationMinutes: 30 },
      { id: 'skip', title: 'Skip', durationMinutes: 20, disabled: true },
    ]
    const checkpoint = createCheckpoint(withDisabled, anchor)
    expect(checkpoint.tasks[1]!.disabled).toBe(true)
    const rebuilt = tasksFromCheckpoint(checkpoint)
    expect(rebuilt[1]!.disabled).toBe(true)
    expect(tasksMatchCheckpoint(withDisabled, checkpoint)).toBe(true)
    expect(
      tasksMatchCheckpoint(
        [
          withDisabled[0]!,
          { id: 'skip', title: 'Skip', durationMinutes: 20 },
        ],
        checkpoint,
      ),
    ).toBe(false)
  })

  it('stores the anchor and treats kind/time changes as drift', () => {
    const checkpoint = createCheckpoint(tasks, anchor)
    expect(checkpoint.anchor).toEqual(anchor)
    expect(
      groupMatchesCheckpoint({ tasks, anchor }, checkpoint),
    ).toBe(true)
    expect(
      groupMatchesCheckpoint(
        { tasks, anchor: { ...anchor, kind: 'start' } },
        checkpoint,
      ),
    ).toBe(false)
    expect(
      groupMatchesCheckpoint(
        { tasks, anchor: { ...anchor, at: '2026-07-18T18:00:00.000Z' } },
        checkpoint,
      ),
    ).toBe(false)
  })

  it('ignores missing legacy checkpoint anchors when matching the group', () => {
    const checkpoint = createCheckpoint(tasks, anchor)
    delete checkpoint.anchor
    expect(
      groupMatchesCheckpoint(
        { tasks, anchor: { kind: 'start', at: '2026-07-18T09:00:00.000Z' } },
        checkpoint,
      ),
    ).toBe(true)
  })
})

describe('planGotDelayed / applyGotDelayed', () => {
  it('inserts a rounded empty delay before the current start-anchored block', () => {
    const anchor: StackAnchor = {
      kind: 'start',
      at: '2026-07-18T09:00:00.000Z',
    }
    // 90m stack: 09:00–10:30. At 09:17 → in first block, delay = 15.
    const now = new Date('2026-07-18T09:17:00.000Z')
    const planned = planGotDelayed(tasks, anchor, now)
    expect(planned).toEqual({
      ok: true,
      index: 0,
      delayMinutes: 15,
    })
    const next = applyGotDelayed(
      { id: 'g', tasks, anchor },
      now,
    )!
    expect(next.tasks).toHaveLength(4)
    expect(next.tasks[0]).toMatchObject({
      title: 'Delay',
      durationMinutes: 15,
      empty: true,
      delay: true,
    })
    expect(next.tasks[1]!.id).toBe('a')
    const resolved = resolveStack(next.tasks, anchorOnDay(next.anchor, now))
    expect(resolved[1]!.start.toISOString()).toBe('2026-07-18T09:15:00.000Z')
  })

  it('keeps the end anchor unchanged when inserting a delay', () => {
    const anchor: StackAnchor = {
      kind: 'end',
      at: '2026-07-18T10:30:00.000Z',
    }
    // Same 09:00–10:30 stack. At 09:17 in first block.
    const now = new Date('2026-07-18T09:17:00.000Z')
    const planned = planGotDelayed(tasks, anchor, now)
    expect(planned).toEqual({
      ok: true,
      index: 0,
      delayMinutes: 15,
    })

    const next = applyGotDelayed({ id: 'g', tasks, anchor }, now)!
    expect(next.anchor).toEqual(anchor)
    const resolved = resolveStack(next.tasks, anchorOnDay(next.anchor, now))
    expect(resolved[0]!.title).toBe('Delay')
    expect(resolved[0]!.delay).toBe(true)
    // End-anchored: delay inserts before A and walks backward from fixed end.
    expect(resolved[resolved.length - 1]!.end.toISOString()).toBe(
      '2026-07-18T10:30:00.000Z',
    )
  })

  it('appends a delay at the end when now is outside the stack', () => {
    const anchor: StackAnchor = {
      kind: 'start',
      at: '2026-07-18T09:00:00.000Z',
    }
    expect(
      planGotDelayed(tasks, anchor, new Date('2026-07-18T08:59:00.000Z')),
    ).toEqual({ ok: true, index: 3, delayMinutes: 5 })
    expect(
      planGotDelayed(tasks, anchor, new Date('2026-07-18T11:00:00.000Z')),
    ).toEqual({ ok: true, index: 3, delayMinutes: 30 })
  })

  it('uses at least 5 minutes when barely into the first block', () => {
    const anchor: StackAnchor = {
      kind: 'start',
      at: '2026-07-18T09:00:00.000Z',
    }
    expect(
      planGotDelayed(tasks, anchor, new Date('2026-07-18T09:01:00.000Z')),
    ).toEqual({ ok: true, index: 0, delayMinutes: 5 })
  })

  it('inserts two blocks back when within 5 minutes of the current block start', () => {
    const anchor: StackAnchor = {
      kind: 'start',
      at: '2026-07-18T09:00:00.000Z',
    }
    // B starts at 09:30; at 09:32 we're <5m in → delay before A (index 0).
    const now = new Date('2026-07-18T09:32:00.000Z')
    const planned = planGotDelayed(tasks, anchor, now)
    expect(planned).toEqual({
      ok: true,
      index: 0,
      delayMinutes: 30,
    })
    const next = applyGotDelayed({ id: 'g', tasks, anchor }, now)!
    expect(next.tasks.map((t) => t.title)).toEqual([
      'Delay',
      'A',
      'B',
      'C',
    ])
    expect(next.tasks[0]).toMatchObject({
      durationMinutes: 30,
      empty: true,
      delay: true,
    })
  })
})

describe('toggleAnchorPreservingStack', () => {
  it('shifts at by the stack duration so resolved times stay put', () => {
    const startAnchor: StackAnchor = {
      kind: 'start',
      at: '2026-07-18T09:00:00.000Z',
    }
    const total = 90
    const asEnd = toggleAnchorPreservingStack(startAnchor, total)
    expect(asEnd).toEqual({
      kind: 'end',
      at: '2026-07-18T10:30:00.000Z',
    })
    expect(toggleAnchorPreservingStack(asEnd, total)).toEqual(startAnchor)

    const fromStart = resolveStack(tasks, startAnchor)
    const fromEnd = resolveStack(tasks, asEnd)
    expect(fromEnd[0]!.start.toISOString()).toBe(fromStart[0]!.start.toISOString())
    expect(fromEnd[2]!.end.toISOString()).toBe(fromStart[2]!.end.toISOString())
  })

  it('only flips kind when duration is zero', () => {
    const anchor: StackAnchor = {
      kind: 'end',
      at: '2026-07-18T09:00:00.000Z',
    }
    expect(toggleAnchorPreservingStack(anchor, 0)).toEqual({
      kind: 'start',
      at: anchor.at,
    })
  })
})

describe('execution helpers', () => {
  const startAnchor: StackAnchor = {
    kind: 'start',
    at: '2026-07-18T09:00:00.000Z',
  }

  it('isGroupExecutableNow is true within an hour of the stack', () => {
    const group = { tasks, anchor: startAnchor }
    // Stack is 09:00–10:30 UTC in these fixtures.
    expect(
      isGroupExecutableNow(group, new Date('2026-07-18T08:00:00.000Z')),
    ).toBe(true)
    expect(
      isGroupExecutableNow(group, new Date('2026-07-18T07:59:00.000Z')),
    ).toBe(false)
    expect(
      isGroupExecutableNow(group, new Date('2026-07-18T09:15:00.000Z')),
    ).toBe(true)
    expect(
      isGroupExecutableNow(group, new Date('2026-07-18T10:30:00.000Z')),
    ).toBe(true)
    expect(
      isGroupExecutableNow(group, new Date('2026-07-18T11:30:00.000Z')),
    ).toBe(true)
    expect(
      isGroupExecutableNow(group, new Date('2026-07-18T11:30:01.000Z')),
    ).toBe(false)
    expect(
      isGroupExecutableNow(
        { ...group, enabled: false },
        new Date('2026-07-18T09:15:00.000Z'),
      ),
    ).toBe(false)
  })

  it('shouldAutoEndExecution is true 2 hours after the last active block', () => {
    const group = { tasks, anchor: startAnchor }
    // Stack is 09:00–10:30 UTC; auto-end at 12:30.
    expect(
      shouldAutoEndExecution(group, new Date('2026-07-18T10:30:00.000Z')),
    ).toBe(false)
    expect(
      shouldAutoEndExecution(group, new Date('2026-07-18T12:29:59.000Z')),
    ).toBe(false)
    expect(
      shouldAutoEndExecution(group, new Date('2026-07-18T12:30:00.000Z')),
    ).toBe(true)
  })

  it('shouldAutoEndExecution ignores disabled trailing tasks', () => {
    const group = {
      tasks: [
        ...tasks,
        { id: 'd', title: 'D', durationMinutes: 60, disabled: true },
      ],
      anchor: startAnchor,
    }
    expect(
      shouldAutoEndExecution(group, new Date('2026-07-18T12:30:00.000Z')),
    ).toBe(true)
    expect(
      shouldAutoEndExecution(group, new Date('2026-07-18T13:29:59.000Z')),
    ).toBe(true)
  })

  it('shouldAutoEndExecution is false when every task is disabled', () => {
    expect(
      shouldAutoEndExecution(
        {
          tasks: [{ id: 'a', title: 'A', durationMinutes: 30, disabled: true }],
          anchor: startAnchor,
        },
        new Date('2026-07-18T20:00:00.000Z'),
      ),
    ).toBe(false)
  })

  it('prepareGroupForExecution flips to Starts and captures intended end', () => {
    const endAnchor: StackAnchor = {
      kind: 'end',
      at: '2026-07-18T10:30:00.000Z',
    }
    const now = new Date('2026-07-18T09:00:00.000Z')
    const next = prepareGroupForExecution(
      { id: 'g', tasks, anchor: endAnchor },
      now,
    )
    expect(next.anchor).toEqual(startAnchor)
    expect(next.intendedEndAt).toBe('2026-07-18T10:30:00.000Z')
  })

  it('prepareGroupForExecution keeps an existing intendedEndAt', () => {
    const next = prepareGroupForExecution(
      {
        id: 'g',
        tasks,
        anchor: startAnchor,
        intendedEndAt: '2026-07-18T11:00:00.000Z',
      },
      new Date('2026-07-18T09:00:00.000Z'),
    )
    expect(next.intendedEndAt).toBe('2026-07-18T11:00:00.000Z')
  })

  it('getStackEndStatus reports late, early, and on-time', () => {
    const delayed = applyGotDelayed(
      { id: 'g', tasks, anchor: startAnchor },
      new Date('2026-07-18T09:17:00.000Z'),
    )!
    const withIntent = {
      ...delayed,
      intendedEndAt: '2026-07-18T10:30:00.000Z',
    }
    const late = getStackEndStatus(
      withIntent,
      new Date('2026-07-18T12:00:00.000Z'),
    )
    expect(late).toMatchObject({ kind: 'late', delayedMinutes: 15 })

    expect(
      getStackEndStatus(
        { tasks, anchor: startAnchor, intendedEndAt: '2026-07-18T10:30:00.000Z' },
        new Date('2026-07-18T12:00:00.000Z'),
      ),
    ).toMatchObject({ kind: 'on-time' })

    expect(
      getStackEndStatus(
        {
          tasks,
          anchor: startAnchor,
          intendedEndAt: '2026-07-18T11:00:00.000Z',
        },
        new Date('2026-07-18T12:00:00.000Z'),
      ),
    ).toMatchObject({ kind: 'early', earlyMinutes: 30 })

    expect(
      getStackDelayOverrun(
        { tasks, anchor: startAnchor, intendedEndAt: '2026-07-18T10:30:00.000Z' },
        new Date('2026-07-18T12:00:00.000Z'),
      ),
    ).toBeNull()
  })

  it('stackOccupiedLocalDays covers every local day the stack touches', () => {
    const start = new Date(2026, 6, 18, 22, 0, 0)
    const days = stackOccupiedLocalDays({
      tasks: [{ id: 'a', title: 'Late', durationMinutes: 180 }],
      anchor: { kind: 'start', at: start.toISOString() },
    })
    expect(days).not.toBeNull()
    expect(days!.first.getTime()).toBe(
      startOfLocalDay(new Date(2026, 6, 18)).getTime(),
    )
    expect(days!.last.getTime()).toBe(
      startOfLocalDay(new Date(2026, 6, 19)).getTime(),
    )
  })

  it('canNavigateCalendarRange disables steps that leave the stack days', () => {
    const first = startOfLocalDay(new Date(2026, 6, 18))
    const last = startOfLocalDay(new Date(2026, 6, 19))
    const day0 = first
    const day1 = startOfLocalDay(new Date(2026, 6, 19))
    const day2 = startOfLocalDay(new Date(2026, 6, 20))
    expect(
      canNavigateCalendarRange(day0, day1, { first, last }, 'prev'),
    ).toBe(false)
    expect(
      canNavigateCalendarRange(day0, day1, { first, last }, 'next'),
    ).toBe(true)
    expect(
      canNavigateCalendarRange(day1, day2, { first, last }, 'prev'),
    ).toBe(true)
    expect(
      canNavigateCalendarRange(day1, day2, { first, last }, 'next'),
    ).toBe(false)
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
