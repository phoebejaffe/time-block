import { useCallback, useEffect, useRef, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { getFirebaseAuth, isFirebaseConfigured } from '../lib/firebase'
import { saveUserState, subscribeUserState } from '../lib/userDataSync'
import {
  loadLegacyPushedEvents,
  loadLegacyPushSnapshots,
  normalizePushSnapshots,
  normalizePushedEvents,
  prunePushedEvents,
  clearGroupDayPushSnapshots,
  upsertPushSnapshot,
  type PushSnapshot,
  type PushedEvent,
} from '../lib/pushedEvents'
import {
  defaultPlan,
  migratePlan,
  normalizeSavedLists,
  removeSavedList,
  upsertSavedList,
  type Plan,
  type SavedTaskList,
  type Task,
} from '../lib/tasks'

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
 * `onRemotePlan`), saved lists, and the target-calendar choice — backed by
 * Firestore under `users/{uid}`. A real-time listener applies remote edits
 * instantly; local edits are debounced and written back with last-write-wins
 * on `updatedAt`.
 *
 * Requires Firebase Auth (see `signInToFirebase` in lib/google.ts), which
 * runs after the Google OAuth exchange using the returned ID token.
 */
export function useUserData({ signedIn, plan, onRemotePlan }: UseUserDataOptions) {
  const [savedLists, setSavedLists] = useState<SavedTaskList[]>([])
  const [targetCalendarId, setTargetCalendarIdState] = useState('')
  const [pushedEvents, setPushedEvents] = useState<PushedEvent[]>([])
  const [pushSnapshots, setPushSnapshots] = useState<PushSnapshot[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)

  const skipNextPushRef = useRef(false)
  const pushPendingRef = useRef(false)
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSyncedAtRef = useRef<string | null>(null)
  const seededRef = useRef(false)

  const stateRef = useRef({
    plan,
    savedLists,
    targetCalendarId,
    pushedEvents,
    pushSnapshots,
  })
  stateRef.current = {
    plan,
    savedLists,
    targetCalendarId,
    pushedEvents,
    pushSnapshots,
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

  const applyRemote = useCallback(
    (remote: {
      updatedAt: string
      plan: unknown
      savedLists: unknown
      targetCalendarId: unknown
      pushedEvents: unknown
      pushSnapshots: unknown
    }) => {
      skipNextPushRef.current = true
      const migrated = migratePlan(remote.plan)
      onRemotePlanRef.current(migrated ?? defaultPlan())
      setSavedLists(normalizeSavedLists(remote.savedLists))
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
      if (legacyEvents.length > 0 || legacySnapshots.length > 0) {
        skipNextPushRef.current = false
      }
      lastSyncedAtRef.current = remote.updatedAt
    },
    [],
  )

  const pushNow = useCallback(async (uid: string) => {
    const {
      plan: p,
      savedLists: sl,
      targetCalendarId: tc,
      pushedEvents: pe,
      pushSnapshots: ps,
    } = stateRef.current
    const updatedAt = new Date().toISOString()
    await saveUserState(uid, {
      updatedAt,
      plan: p,
      savedLists: sl,
      targetCalendarId: tc,
      pushedEvents: pe,
      pushSnapshots: ps,
    })
    lastSyncedAtRef.current = updatedAt
  }, [])

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
          if (isNewer) applyRemote(remote)
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
  }, [signedIn, firebaseUser, applyRemote, pushNow])

  // Debounced push whenever the plan, saved lists, or target calendar change.
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
  }, [plan, savedLists, targetCalendarId, pushedEvents, pushSnapshots, signedIn, firebaseUser, loading, pushNow])

  const saveList = useCallback(
    (name: string, tasks: Task[], replaceId?: string): SavedTaskList => {
      const { lists, saved } = upsertSavedList(savedLists, name, tasks, replaceId)
      setSavedLists(lists)
      return saved
    },
    [savedLists],
  )

  const deleteList = useCallback((id: string) => {
    setSavedLists((prev) => removeSavedList(prev, id))
  }, [])

  const setTargetCalendarId = useCallback((id: string) => {
    setTargetCalendarIdState(id)
  }, [])

  const applyCalendarSync = useCallback(
    (events: PushedEvent[], snapshot: PushSnapshot | null) => {
      setPushedEvents(prunePushedEvents(events))
      if (snapshot) {
        setPushSnapshots((prev) =>
          upsertPushSnapshot(
            prev,
            snapshot.calendarId,
            snapshot.groupId,
            snapshot.dayKey,
            snapshot.fingerprint,
          ),
        )
      }
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
    pushPendingRef.current = false
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    lastSyncedAtRef.current = null
    seededRef.current = false
    setSavedLists([])
    setTargetCalendarIdState('')
    setPushedEvents([])
    setPushSnapshots([])
    setStatus('idle')
    setSyncError(null)
    setLoading(false)
    setFirebaseUser(null)
  }, [])

  return {
    savedLists,
    targetCalendarId,
    pushedEvents,
    pushSnapshots,
    loading: loading || (signedIn && !firebaseUser && isFirebaseConfigured()),
    status,
    syncError,
    saveList,
    deleteList,
    setTargetCalendarId,
    applyCalendarSync,
    applyCalendarDelete,
    reset,
  }
}
