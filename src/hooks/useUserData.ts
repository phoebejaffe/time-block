import { useCallback, useEffect, useRef, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { getFirebaseAuth, isFirebaseConfigured } from '../lib/firebase'
import {
  migrateLegacyPlanArchive,
  savePlanArchive,
  saveUserState,
  subscribePlanArchive,
  subscribeUserState,
} from '../lib/userDataSync'
import {
  loadLegacyPushedEvents,
  loadLegacyPushSnapshots,
  normalizePushSnapshots,
  normalizePushedEvents,
  prunePushedEvents,
  clearGroupDayPushSnapshots,
  clearGroupDayCalendarPushSnapshot,
  upsertPushSnapshot,
  type PushSnapshot,
  type PushedEvent,
} from '../lib/pushedEvents'
import {
  defaultPlan,
  defaultBlockLibrary,
  migratePlan,
  normalizeBlockLibrary,
  type BlockLibrary,
  type Plan,
} from '../lib/tasks'
import {
  defaultPlanArchive,
  normalizePlanArchive,
  type PlanArchive,
} from '../lib/planArchive'
import {
  normalizeSavedCalendarUsers,
  type SavedCalendarUser,
} from '../lib/savedCalendarUsers'
import {
  defaultUserSettings,
  normalizeUserSettings,
  type UserSettings,
} from '../lib/userSettings'

/** Wait for a pause in edits before pushing — most edits arrive in bursts. */
const PUSH_DEBOUNCE_MS = 2_000

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error'

type UseUserDataOptions = {
  signedIn: boolean
  plan: Plan
  onRemotePlan: (plan: Plan) => void
}

/**
 * Owns everything that syncs across devices — the plan (via the caller's
 * `onRemotePlan`), block library, archived plans, saved calendar users,
 * and the target-calendar
 * choice — backed by Firestore under `users/{uid}`. A real-time listener
 * applies remote edits instantly; local edits are debounced and written
 * back with last-write-wins on `updatedAt`.
 *
 * Archived plans sync from a separate Firestore fragment document and load
 * on demand (see `ensurePlanArchiveLoaded`).
 *
 * Requires Firebase Auth (see `signInToFirebase` in lib/google.ts), which
 * runs after the Google OAuth exchange using the returned ID token.
 */
export function useUserData({ signedIn, plan, onRemotePlan }: UseUserDataOptions) {
  const [blockLibrary, setBlockLibrary] = useState<BlockLibrary>(() =>
    defaultBlockLibrary(),
  )
  const [planArchive, setPlanArchive] = useState<PlanArchive>(() =>
    defaultPlanArchive(),
  )
  const [planArchiveLoading, setPlanArchiveLoading] = useState(false)
  const [planArchiveSyncEnabled, setPlanArchiveSyncEnabled] = useState(false)
  const [targetCalendarId, setTargetCalendarIdState] = useState('')
  const [pushedEvents, setPushedEvents] = useState<PushedEvent[]>([])
  const [pushSnapshots, setPushSnapshots] = useState<PushSnapshot[]>([])
  const [executingGroupId, setExecutingGroupIdState] = useState<string | null>(
    null,
  )
  const [savedCalendarUsers, setSavedCalendarUsers] = useState<
    SavedCalendarUser[]
  >([])
  const [settings, setSettings] = useState<UserSettings>(() =>
    defaultUserSettings(),
  )
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)

  const skipNextPushRef = useRef(false)
  const pushPendingRef = useRef(false)
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSyncedAtRef = useRef<string | null>(null)
  const seededRef = useRef(false)

  const planArchiveLoadedRef = useRef(false)
  const planArchiveUnsubRef = useRef<(() => void) | null>(null)
  const planArchiveLoadPromiseRef = useRef<Promise<void> | null>(null)
  const skipNextArchivePushRef = useRef(false)
  const archivePushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastArchiveSyncedAtRef = useRef<string | null>(null)
  const legacyPlanArchiveRef = useRef<unknown>(null)
  const archiveMigrateStartedRef = useRef(false)
  const archiveMigratePromiseRef = useRef<Promise<void> | null>(null)

  const stateRef = useRef({
    plan,
    blockLibrary,
    planArchive,
    targetCalendarId,
    pushedEvents,
    pushSnapshots,
    executingGroupId,
    savedCalendarUsers,
    settings,
  })
  stateRef.current = {
    plan,
    blockLibrary,
    planArchive,
    targetCalendarId,
    pushedEvents,
    pushSnapshots,
    executingGroupId,
    savedCalendarUsers,
    settings,
  }

  const onRemotePlanRef = useRef(onRemotePlan)
  onRemotePlanRef.current = onRemotePlan

  useEffect(() => {
    if (!signedIn || !isFirebaseConfigured()) {
      setFirebaseUser(null)
      return
    }
    return onAuthStateChanged(getFirebaseAuth(), setFirebaseUser)
  }, [signedIn])

  const applyRemoteArchive = useCallback(
    (remote: { updatedAt: string; planArchive: PlanArchive }) => {
      const isNewer =
        !lastArchiveSyncedAtRef.current ||
        new Date(remote.updatedAt) > new Date(lastArchiveSyncedAtRef.current)
      if (!isNewer) return
      skipNextArchivePushRef.current = true
      setPlanArchive(normalizePlanArchive(remote.planArchive))
      lastArchiveSyncedAtRef.current = remote.updatedAt
    },
    [],
  )

  const applyRemote = useCallback(
    (remote: {
      updatedAt: string
      plan: unknown
      blockLibrary: unknown
      legacyPlanArchive?: unknown
      targetCalendarId: unknown
      pushedEvents: unknown
      pushSnapshots: unknown
      executingGroupId?: unknown
      savedCalendarUsers?: unknown
      settings?: unknown
    }) => {
      skipNextPushRef.current = true
      const migrated = migratePlan(remote.plan)
      onRemotePlanRef.current(migrated ?? defaultPlan())
      setBlockLibrary(
        remote.blockLibrary != null
          ? normalizeBlockLibrary(remote.blockLibrary)
          : defaultBlockLibrary(),
      )
      if (remote.legacyPlanArchive != null) {
        legacyPlanArchiveRef.current = remote.legacyPlanArchive
      }
      setTargetCalendarIdState(
        typeof remote.targetCalendarId === 'string' ? remote.targetCalendarId : '',
      )
      const remoteEvents = normalizePushedEvents(remote.pushedEvents)
      const legacyEvents =
        remoteEvents.length === 0 ? loadLegacyPushedEvents() : []
      const remoteSnapshots = normalizePushSnapshots(remote.pushSnapshots)
      const legacySnapshots =
        remoteSnapshots.length === 0 ? loadLegacyPushSnapshots() : []
      setPushedEvents(remoteEvents.length > 0 ? remoteEvents : legacyEvents)
      setPushSnapshots(
        remoteSnapshots.length > 0 ? remoteSnapshots : legacySnapshots,
      )
      const remoteExecuting =
        typeof remote.executingGroupId === 'string' && remote.executingGroupId
          ? remote.executingGroupId
          : null
      const planGroups = migrated?.groups ?? []
      setExecutingGroupIdState(
        remoteExecuting && planGroups.some((g) => g.id === remoteExecuting)
          ? remoteExecuting
          : null,
      )
      setSavedCalendarUsers(
        normalizeSavedCalendarUsers(remote.savedCalendarUsers),
      )
      setSettings(
        remote.settings != null
          ? normalizeUserSettings(remote.settings)
          : defaultUserSettings(),
      )
      if (legacyEvents.length > 0 || legacySnapshots.length > 0) {
        skipNextPushRef.current = false
      }
      lastSyncedAtRef.current = remote.updatedAt
    },
    [],
  )

  const pushNow = useCallback(async (uid: string) => {
    if (archiveMigratePromiseRef.current) {
      await archiveMigratePromiseRef.current
    }
    const {
      plan: p,
      blockLibrary: bl,
      targetCalendarId: tc,
      pushedEvents: pe,
      pushSnapshots: ps,
      executingGroupId: eg,
      savedCalendarUsers: su,
      settings: st,
    } = stateRef.current
    const updatedAt = new Date().toISOString()
    await saveUserState(uid, {
      updatedAt,
      plan: p,
      blockLibrary: bl,
      targetCalendarId: tc,
      pushedEvents: pe,
      pushSnapshots: ps,
      executingGroupId: eg,
      savedCalendarUsers: su,
      settings: st,
    })
    lastSyncedAtRef.current = updatedAt
  }, [])

  const pushArchiveNow = useCallback(async (uid: string) => {
    const { planArchive: pa } = stateRef.current
    const updatedAt = new Date().toISOString()
    await savePlanArchive(uid, {
      updatedAt,
      planArchive: pa,
    })
    lastArchiveSyncedAtRef.current = updatedAt
  }, [])

  const startLegacyArchiveMigration = useCallback((uid: string, legacy: unknown) => {
    if (archiveMigrateStartedRef.current) return
    archiveMigrateStartedRef.current = true
    archiveMigratePromiseRef.current = migrateLegacyPlanArchive(uid, legacy).catch(
      (err) => {
        archiveMigrateStartedRef.current = false
        archiveMigratePromiseRef.current = null
        throw err
      },
    )
  }, [])

  const finishPlanArchiveLoad = useCallback(() => {
    planArchiveLoadedRef.current = true
    setPlanArchiveSyncEnabled(true)
    setPlanArchiveLoading(false)
    planArchiveLoadPromiseRef.current = null
  }, [])

  const ensurePlanArchiveLoaded = useCallback((): Promise<void> => {
    if (planArchiveLoadedRef.current) return Promise.resolve()
    if (planArchiveLoadPromiseRef.current) return planArchiveLoadPromiseRef.current
    if (!signedIn || !firebaseUser) return Promise.resolve()

    const uid = firebaseUser.uid
    setPlanArchiveLoading(true)

    planArchiveLoadPromiseRef.current = new Promise<void>((resolve, reject) => {
      let settled = false
      let initial = true

      const settleOk = () => {
        if (settled) return
        settled = true
        finishPlanArchiveLoad()
        resolve()
      }
      const settleErr = (err: Error) => {
        if (settled) return
        settled = true
        setPlanArchiveLoading(false)
        planArchiveLoadPromiseRef.current = null
        reject(err)
      }

      planArchiveUnsubRef.current = subscribePlanArchive(
        uid,
        (remote) => {
          if (remote) {
            applyRemoteArchive(remote)
            if (initial) {
              initial = false
              settleOk()
            }
            return
          }
          if (!initial) return
          initial = false
          if (legacyPlanArchiveRef.current != null) {
            const normalized = normalizePlanArchive(legacyPlanArchiveRef.current)
            skipNextArchivePushRef.current = true
            setPlanArchive(normalized)
            lastArchiveSyncedAtRef.current = normalized.updatedAt
            legacyPlanArchiveRef.current = null
            void pushArchiveNow(uid).then(settleOk).catch(settleErr)
            return
          }
          settleOk()
        },
        settleErr,
      )
    })

    return planArchiveLoadPromiseRef.current
  }, [
    signedIn,
    firebaseUser,
    applyRemoteArchive,
    finishPlanArchiveLoad,
    pushArchiveNow,
  ])

  // Real-time Firestore subscription for this user.
  useEffect(() => {
    if (!signedIn || !firebaseUser) {
      seededRef.current = false
      if (!signedIn) setLoading(false)
      return
    }

    setLoading(true)
    setStatus('syncing')
    setSyncError(null)

    const uid = firebaseUser.uid
    const unsubscribe = subscribeUserState(
      uid,
      (remote) => {
        if (remote) {
          const isNewer =
            !lastSyncedAtRef.current ||
            new Date(remote.updatedAt) > new Date(lastSyncedAtRef.current)
          if (isNewer) {
            applyRemote(remote)
            if (remote.legacyPlanArchive != null) {
              startLegacyArchiveMigration(uid, remote.legacyPlanArchive)
            }
          }
          setStatus('synced')
          setLoading(false)
        } else if (!seededRef.current) {
          seededRef.current = true
          skipNextPushRef.current = true
          const legacyEvents = loadLegacyPushedEvents()
          const legacySnapshots = loadLegacyPushSnapshots()
          if (legacyEvents.length > 0) {
            setPushedEvents(legacyEvents)
            stateRef.current.pushedEvents = legacyEvents
          }
          if (legacySnapshots.length > 0) {
            setPushSnapshots(legacySnapshots)
            stateRef.current.pushSnapshots = legacySnapshots
          }
          void pushNow(uid)
            .then(() => setStatus('synced'))
            .catch((err) => {
              setStatus('error')
              setSyncError(
                err instanceof Error ? err.message : 'Could not save to Firestore',
              )
            })
            .finally(() => setLoading(false))
        } else {
          setStatus('synced')
          setLoading(false)
        }
      },
      (err) => {
        setStatus('error')
        setSyncError(err.message)
        setLoading(false)
      },
    )

    return () => {
      unsubscribe()
      seededRef.current = false
    }
  }, [signedIn, firebaseUser, applyRemote, pushNow, startLegacyArchiveMigration])

  // Debounced push whenever synced user data changes.
  useEffect(() => {
    if (!signedIn || !firebaseUser || loading) return
    if (skipNextPushRef.current) {
      skipNextPushRef.current = false
      return
    }

    pushPendingRef.current = true
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    pushTimerRef.current = setTimeout(() => {
      pushPendingRef.current = false
      setStatus('syncing')
      setSyncError(null)
      pushNow(firebaseUser.uid)
        .then(() => setStatus('synced'))
        .catch((err) => {
          setStatus('error')
          setSyncError(
            err instanceof Error ? err.message : 'Could not save to Firestore',
          )
        })
    }, PUSH_DEBOUNCE_MS)

    return () => {
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    }
  }, [plan, blockLibrary, targetCalendarId, pushedEvents, pushSnapshots, executingGroupId, savedCalendarUsers, settings, signedIn, firebaseUser, loading, pushNow])

  // Debounced push when archived plans change (after first load).
  useEffect(() => {
    if (!signedIn || !firebaseUser || !planArchiveSyncEnabled) return
    if (skipNextArchivePushRef.current) {
      skipNextArchivePushRef.current = false
      return
    }

    if (archivePushTimerRef.current) clearTimeout(archivePushTimerRef.current)
    archivePushTimerRef.current = setTimeout(() => {
      setStatus('syncing')
      setSyncError(null)
      pushArchiveNow(firebaseUser.uid)
        .then(() => setStatus('synced'))
        .catch((err) => {
          setStatus('error')
          setSyncError(
            err instanceof Error ? err.message : 'Could not save archived plans',
          )
        })
    }, PUSH_DEBOUNCE_MS)

    return () => {
      if (archivePushTimerRef.current) clearTimeout(archivePushTimerRef.current)
    }
  }, [planArchive, planArchiveSyncEnabled, signedIn, firebaseUser, pushArchiveNow])

  const replaceBlockLibrary = useCallback((next: BlockLibrary) => {
    setBlockLibrary(next)
  }, [])

  const replacePlanArchive = useCallback((next: PlanArchive) => {
    planArchiveLoadedRef.current = true
    setPlanArchiveSyncEnabled(true)
    setPlanArchive(next)
  }, [])

  const setTargetCalendarId = useCallback((id: string) => {
    setTargetCalendarIdState(id)
  }, [])

  const setExecutingGroupId = useCallback((id: string | null) => {
    setExecutingGroupIdState(id)
  }, [])

  const replaceSavedCalendarUsers = useCallback((next: SavedCalendarUser[]) => {
    setSavedCalendarUsers(normalizeSavedCalendarUsers(next))
  }, [])

  const replaceSettings = useCallback((next: UserSettings) => {
    setSettings(normalizeUserSettings(next))
  }, [])

  const patchSettings = useCallback((patch: Partial<UserSettings>) => {
    setSettings((prev) => normalizeUserSettings({ ...prev, ...patch }))
  }, [])

  const applyCalendarSync = useCallback(
    (
      events: PushedEvent[],
      snapshots: PushSnapshot[],
      removedCalendarIds: { calendarId: string; groupId: string; dayKey: string }[] = [],
    ) => {
      setPushedEvents(prunePushedEvents(events))
      setPushSnapshots((prev) => {
        let next = prev
        for (const removed of removedCalendarIds) {
          next = clearGroupDayCalendarPushSnapshot(
            next,
            removed.calendarId,
            removed.groupId,
            removed.dayKey,
          )
        }
        for (const snapshot of snapshots) {
          next = upsertPushSnapshot(
            next,
            snapshot.calendarId,
            snapshot.groupId,
            snapshot.dayKey,
            snapshot.fingerprint,
          )
        }
        return next
      })
    },
    [],
  )

  const applyCalendarDelete = useCallback(
    (events: PushedEvent[], groupId: string, dayKey: string) => {
      setPushedEvents(prunePushedEvents(events))
      setPushSnapshots((prev) =>
        events.some((e) => e.groupId === groupId && e.dayKey === dayKey)
          ? prev
          : clearGroupDayPushSnapshots(prev, groupId, dayKey),
      )
    },
    [],
  )

  /** Reset to blank, in-memory only — call on sign-out. */
  const reset = useCallback(() => {
    skipNextPushRef.current = false
    skipNextArchivePushRef.current = false
    pushPendingRef.current = false
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    if (archivePushTimerRef.current) clearTimeout(archivePushTimerRef.current)
    planArchiveUnsubRef.current?.()
    planArchiveUnsubRef.current = null
    planArchiveLoadPromiseRef.current = null
    planArchiveLoadedRef.current = false
    lastSyncedAtRef.current = null
    lastArchiveSyncedAtRef.current = null
    legacyPlanArchiveRef.current = null
    archiveMigrateStartedRef.current = false
    archiveMigratePromiseRef.current = null
    seededRef.current = false
    setBlockLibrary(defaultBlockLibrary())
    setPlanArchive(defaultPlanArchive())
    setPlanArchiveLoading(false)
    setPlanArchiveSyncEnabled(false)
    setTargetCalendarIdState('')
    setPushedEvents([])
    setPushSnapshots([])
    setExecutingGroupIdState(null)
    setSavedCalendarUsers([])
    setSettings(defaultUserSettings())
    setStatus('idle')
    setSyncError(null)
    setLoading(false)
    setFirebaseUser(null)
  }, [])

  return {
    blockLibrary,
    planArchive,
    planArchiveLoading,
    ensurePlanArchiveLoaded,
    targetCalendarId,
    pushedEvents,
    pushSnapshots,
    executingGroupId,
    savedCalendarUsers,
    settings,
    firebaseUser,
    loading: loading || (signedIn && !firebaseUser && isFirebaseConfigured()),
    status,
    syncError,
    replaceBlockLibrary,
    replacePlanArchive,
    setTargetCalendarId,
    setExecutingGroupId,
    replaceSavedCalendarUsers,
    replaceSettings,
    patchSettings,
    applyCalendarSync,
    applyCalendarDelete,
    reset,
  }
}
