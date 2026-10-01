import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addArchivedPlan,
  addArchiveFolder,
  archivedPlanCount,
  defaultPlanArchive,
  moveArchivedPlanToFolder,
  removeArchivedPlan,
  type ArchivedPlan,
  type PlanArchive,
} from '../lib/planArchive'
import { defaultPlan } from '../lib/tasks'
import { savePlanArchive } from '../lib/userDataSync'
import { useUserData } from './useUserData'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type ArchivePayload = { updatedAt: string; planArchive: PlanArchive } | null

let archiveOnData: ((payload: ArchivePayload) => void) | null = null
let userStateOnData: ((payload: unknown) => void) | null = null

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(() => () => {}),
}))

vi.mock('../lib/firebase', () => ({
  isFirebaseConfigured: () => true,
  getFirebaseAuth: () => ({ currentUser: { uid: 'u1' } }),
}))

vi.mock('../lib/google', () => ({
  linkFirebaseFromGoogleSession: vi.fn(async () => true),
}))

vi.mock('../lib/userDataSync', () => ({
  saveUserState: vi.fn(async () => {}),
  savePlanArchive: vi.fn(async () => {}),
  fetchPlanArchive: vi.fn(async () => null),
  migrateLegacyPlanArchive: vi.fn(async () => {}),
  subscribeUserState: vi.fn(
    (_uid: string, onData: (payload: unknown) => void) => {
      userStateOnData = onData
      return () => {}
    },
  ),
  subscribePlanArchive: vi.fn(
    (_uid: string, onData: (payload: ArchivePayload) => void) => {
      archiveOnData = onData
      return () => {}
    },
  ),
}))

function archivedPlan(id: string): ArchivedPlan {
  return {
    id,
    tasks: [{ title: `Plan ${id}`, durationMinutes: 30 }],
    anchor: { kind: 'start', at: '2026-10-01T09:00:00.000Z' },
    archivedAt: '2026-10-01T08:00:00.000Z',
  }
}

function archiveWith(...plans: ArchivedPlan[]): PlanArchive {
  return plans.reduce(
    (archive, plan) => addArchivedPlan(archive, plan),
    defaultPlanArchive(),
  )
}

function planIds(archive: PlanArchive): string[] {
  return archive.folders.flatMap((f) => f.plans.map((p) => p.id)).sort()
}

/** Every archive payload this session wrote to Firestore, in order. */
function pushedArchives(): PlanArchive[] {
  return vi.mocked(savePlanArchive).mock.calls.map((call) => call[1].planArchive)
}

function renderUserData() {
  let current!: ReturnType<typeof useUserData>
  function Harness() {
    current = useUserData({
      signedIn: true,
      plan: defaultPlan(),
      onRemotePlan: () => {},
    })
    return null
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(Harness))
  })
  return {
    get current() {
      return current
    },
    unmount() {
      act(() => root.unmount())
      container.remove()
    },
  }
}

const roots: ReturnType<typeof renderUserData>[] = []

function view() {
  const v = renderUserData()
  roots.push(v)
  return v
}

beforeEach(() => {
  archiveOnData = null
  userStateOnData = null
})

afterEach(() => {
  while (roots.length) roots.pop()!.unmount()
  vi.useRealTimers()
  vi.clearAllMocks()
})

async function flushPush() {
  await act(async () => {
    vi.advanceTimersByTime(2500)
  })
}

/** Load the archive fragment and deliver `remote` as the initial snapshot. */
async function loadRemoteArchive(
  v: ReturnType<typeof renderUserData>,
  remote: PlanArchive,
  updatedAt = '2026-10-01T00:00:00.000Z',
) {
  await act(async () => {
    const loading = v.current.ensurePlanArchiveLoaded()
    archiveOnData?.({ updatedAt, planArchive: remote })
    await loading
  })
}

describe('archive load and remote apply', () => {
  it('loads the remote archive on demand without pushing it back', async () => {
    vi.useFakeTimers()
    const v = view()
    await loadRemoteArchive(
      v,
      archiveWith(archivedPlan('a'), archivedPlan('b')),
    )

    expect(archivedPlanCount(v.current.planArchive)).toBe(2)

    await flushPush()
    expect(savePlanArchive).not.toHaveBeenCalled()
  })

  it('ignores a remote snapshot that would drop plans or folders', async () => {
    const v = view()
    const three = archiveWith(
      archivedPlan('a'),
      archivedPlan('b'),
      archivedPlan('c'),
    )
    // Two folders: Unfiled with 3 plans + an empty named folder.
    await loadRemoteArchive(v, addArchiveFolder(three, 'Phoebe'))
    const before = v.current.planArchive

    act(() => {
      // Fewer plans — a shrink, rejected.
      archiveOnData?.({
        updatedAt: '2026-10-01T01:00:00.000Z',
        planArchive: archiveWith(archivedPlan('a')),
      })
      // Same plans but the named folder is gone — still a shrink, rejected.
      archiveOnData?.({
        updatedAt: '2026-10-01T02:00:00.000Z',
        planArchive: three,
      })
    })

    expect(v.current.planArchive).toBe(before)
    expect(v.current.planArchive.folders).toHaveLength(2)
    expect(archivedPlanCount(v.current.planArchive)).toBe(3)
  })

  it('ignores remote echoes that are not newer than our own write', async () => {
    vi.useFakeTimers()
    const v = view()
    await loadRemoteArchive(v, archiveWith(archivedPlan('a')))
    act(() => {
      v.current.replacePlanArchive((current) =>
        addArchivedPlan(current, archivedPlan('b')),
      )
    })
    await flushPush()
    const pushed = pushedArchives().at(-1)!
    const before = v.current.planArchive
    const calls = pushedArchives().length

    act(() => {
      // Echo of our own write — equal updatedAt, must not re-apply.
      archiveOnData?.({ updatedAt: pushed.updatedAt, planArchive: pushed })
      // Older snapshot must not re-apply either.
      archiveOnData?.({
        updatedAt: '2026-09-01T00:00:00.000Z',
        planArchive: archiveWith(
          archivedPlan('a'),
          archivedPlan('b'),
          archivedPlan('c'),
        ),
      })
    })
    await flushPush()

    expect(v.current.planArchive).toBe(before)
    expect(pushedArchives()).toHaveLength(calls)
  })

  it('rejects a stale archive value that shrinks a just-applied remote archive', () => {
    const v = view()
    const remote = archiveWith(archivedPlan('a'), archivedPlan('b'))
    // Emit inside one act so no render flushes between the remote apply and
    // the stale value-form write.
    act(() => {
      void v.current.ensurePlanArchiveLoaded()
      archiveOnData?.({
        updatedAt: '2026-10-01T00:00:00.000Z',
        planArchive: remote,
      })
    })
    act(() => {
      archiveOnData?.({
        updatedAt: '2026-10-01T01:00:00.000Z',
        planArchive: archiveWith(
          archivedPlan('a'),
          archivedPlan('b'),
          archivedPlan('c'),
          archivedPlan('d'),
        ),
      })
      // A value computed from the pre-remote render must not clobber the
      // fresher archive.
      v.current.replacePlanArchive(remote)
    })

    expect(archivedPlanCount(v.current.planArchive)).toBe(4)
  })
})

describe('local archive edits', () => {
  it('applies updates against the just-loaded remote archive, not the last render', async () => {
    // Regression: archiving from Home awaited ensurePlanArchiveLoaded() and
    // then mutated the render-time (empty) archive, dropping every remotely
    // archived plan, and the merged result was never pushed.
    vi.useFakeTimers()
    const v = view()

    await act(async () => {
      const loading = v.current.ensurePlanArchiveLoaded()
      archiveOnData?.({
        updatedAt: '2026-10-01T00:00:00.000Z',
        planArchive: archiveWith(archivedPlan('a'), archivedPlan('b')),
      })
      // The post-await archive mutation runs in the same tick — before React
      // flushes the remote snapshot's render.
      v.current.replacePlanArchive((current) =>
        addArchivedPlan(current, archivedPlan('new')),
      )
      await loading
    })

    expect(planIds(v.current.planArchive)).toEqual(['a', 'b', 'new'])

    await flushPush()
    const pushed = pushedArchives().at(-1)!
    expect(planIds(pushed)).toEqual(['a', 'b', 'new'])
  })

  it('accumulates rapid consecutive updates without dropping any', async () => {
    const v = view()
    await loadRemoteArchive(v, archiveWith(archivedPlan('a')))

    act(() => {
      v.current.replacePlanArchive((current) =>
        addArchivedPlan(current, archivedPlan('b')),
      )
      v.current.replacePlanArchive((current) =>
        addArchivedPlan(current, archivedPlan('c')),
      )
      v.current.replacePlanArchive((current) =>
        addArchivedPlan(current, archivedPlan('d')),
      )
    })

    expect(planIds(v.current.planArchive)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('allows a destructive update to push the shrunk archive', async () => {
    vi.useFakeTimers()
    const v = view()
    await loadRemoteArchive(
      v,
      archiveWith(archivedPlan('a'), archivedPlan('b')),
    )
    act(() => {
      v.current.replacePlanArchive((current) =>
        addArchivedPlan(current, archivedPlan('new')),
      )
    })
    await flushPush()
    expect(planIds(pushedArchives().at(-1)!)).toEqual(['a', 'b', 'new'])

    // Undo of the archive: explicitly destructive, so the shrink must write.
    act(() => {
      v.current.replacePlanArchive(
        (current) => removeArchivedPlan(current, 'new').archive,
        { allowDestructive: true },
      )
    })
    await flushPush()

    expect(planIds(v.current.planArchive)).toEqual(['a', 'b'])
    expect(planIds(pushedArchives().at(-1)!)).toEqual(['a', 'b'])
  })

  it('rejects a non-destructive shrink even when the archive was already loaded', async () => {
    const v = view()
    await loadRemoteArchive(
      v,
      archiveWith(archivedPlan('a'), archivedPlan('b')),
    )
    const before = v.current.planArchive

    act(() => {
      v.current.replacePlanArchive(archiveWith(archivedPlan('a')))
    })

    expect(v.current.planArchive).toBe(before)
    expect(archivedPlanCount(v.current.planArchive)).toBe(2)
  })
})

describe('archive sync safety', () => {
  it('does not write an empty archive when the remote fragment is absent', async () => {
    // Opening the archive (or archiving) on a doc-less account must not push
    // an empty default over a fragment another device may have just written.
    vi.useFakeTimers()
    const v = view()
    await act(async () => {
      const loading = v.current.ensurePlanArchiveLoaded()
      archiveOnData?.(null)
      await loading
    })
    await flushPush()
    expect(savePlanArchive).not.toHaveBeenCalled()

    act(() => {
      v.current.replacePlanArchive((current) =>
        addArchivedPlan(current, archivedPlan('first')),
      )
    })
    await flushPush()
    expect(planIds(pushedArchives().at(-1)!)).toEqual(['first'])
  })

  it('migrates a legacy inline archive to the fragment without losing plans', async () => {
    const v = view()
    const legacy = archiveWith(archivedPlan('old-1'), archivedPlan('old-2'))

    await act(async () => {
      userStateOnData?.({
        updatedAt: '2026-10-01T00:00:00.000Z',
        plan: defaultPlan(),
        legacyPlanArchive: legacy,
      })
    })
    await act(async () => {
      const loading = v.current.ensurePlanArchiveLoaded()
      archiveOnData?.(null)
      await loading
    })

    expect(planIds(v.current.planArchive)).toEqual(['old-1', 'old-2'])
    expect(pushedArchives().at(-1)!.folders.flatMap((f) => f.plans).map((p) => p.id).sort()).toEqual([
      'old-1',
      'old-2',
    ])
  })

  it('never writes to the archive after reset (sign-out)', async () => {
    vi.useFakeTimers()
    const v = view()
    await loadRemoteArchive(
      v,
      archiveWith(archivedPlan('a'), archivedPlan('b')),
    )
    const calls = pushedArchives().length

    act(() => {
      v.current.reset()
    })
    await flushPush()

    expect(archivedPlanCount(v.current.planArchive)).toBe(0)
    expect(pushedArchives()).toHaveLength(calls)
  })

  it('keeps every known plan through the reported archive → folder → move flow', async () => {
    // Mirrors the bug report: two older archived plans, then a few new
    // archives are created and moved into a named folder. No push may ever
    // drop the pre-existing plans.
    vi.useFakeTimers()
    const v = view()
    await loadRemoteArchive(
      v,
      archiveWith(archivedPlan('old-1'), archivedPlan('old-2')),
    )

    act(() => {
      v.current.replacePlanArchive((current) =>
        addArchivedPlan(current, archivedPlan('p1')),
      )
    })
    await flushPush()
    act(() => {
      v.current.replacePlanArchive((current) =>
        addArchivedPlan(current, archivedPlan('p2')),
      )
    })
    await flushPush()
    act(() => {
      v.current.replacePlanArchive((current) =>
        addArchiveFolder(current, 'Phoebe'),
      )
    })
    await flushPush()

    const folderId = v.current.planArchive.folders.find(
      (f) => f.name === 'Phoebe',
    )!.id
    act(() => {
      v.current.replacePlanArchive((current) =>
        moveArchivedPlanToFolder(current, 'p1', folderId),
      )
      v.current.replacePlanArchive((current) =>
        moveArchivedPlanToFolder(current, 'p2', folderId),
      )
    })
    await flushPush()

    // Every payload ever pushed still contains the two pre-existing plans.
    for (const pushed of pushedArchives()) {
      expect(planIds(pushed)).toEqual(
        expect.arrayContaining(['old-1', 'old-2']),
      )
    }
    const final = v.current.planArchive
    expect(planIds(final)).toEqual(['old-1', 'old-2', 'p1', 'p2'])
    const phoebe = final.folders.find((f) => f.name === 'Phoebe')!
    expect(phoebe.plans.map((p) => p.id)).toEqual(['p1', 'p2'])
  })
})
