import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  hasCommittedOnDay,
  loadCommittedDays,
  localDateKey,
  markCommittedDay,
  migratePlan,
  resolveStack,
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

  it('returns empty for no tasks or invalid anchor', () => {
    expect(resolveStack([], { kind: 'start', at: '2026-07-18T09:00:00.000Z' })).toEqual(
      [],
    )
    expect(
      resolveStack(tasks, { kind: 'end', at: 'not-a-date' }),
    ).toEqual([])
  })
})

describe('migratePlan', () => {
  it('keeps the current { tasks, anchor } shape', () => {
    const plan = migratePlan({
      tasks: [
        { id: '1', title: 'Write', durationMinutes: 25 },
        { id: 'x', title: 'bad' },
      ],
      anchor: { kind: 'start', at: '2026-07-18T08:00:00.000Z' },
    })
    expect(plan).not.toBeNull()
    expect(plan!.tasks).toEqual([
      { id: '1', title: 'Write', durationMinutes: 25 },
    ])
    expect(plan!.anchor).toEqual({
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
    expect(plan!.tasks).toEqual([
      { id: '1', title: 'Old', durationMinutes: 10 },
    ])
    expect(plan!.anchor.kind).toBe('end')
    expect(plan!.anchor.at).toBe('2026-07-18T09:00:00.000Z')
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
    expect(plan!.tasks[0]!.durationMinutes).toBe(1)
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
