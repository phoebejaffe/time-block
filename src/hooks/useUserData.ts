import { useCallback, useEffect, useRef, useState } from 'react'
import { downloadState, resetDriveSyncCache, uploadState } from '../lib/driveSync'
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
/** How often to check Drive for changes made from another device. */
const POLL_INTERVAL_MS = 20_000

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error'

type UseUserDataOptions = {
  signedIn: boolean
  plan: Plan
  onRemotePlan: (plan: Plan) => void
}

/**
 * Owns everything that syncs across devices — the plan (via the caller's
 * `onRemotePlan`), saved lists, and the target-calendar choice — backed
 * entirely by the user's own Drive appDataFolder. Nothing here touches
 * localStorage: Drive is the single source of truth, so on sign-in the app
 * waits (`loading`) for the initial fetch instead of reading a local copy.
 *
 * While signed in, also polls Drive every `POLL_INTERVAL_MS` (and on tab
 * focus/visibility) so edits made on another device show up here quickly,
 * without waiting for a full reload.
 *
 * Assumes the Drive appdata scope was already granted during sign-in (see
 * `signIn` in lib/google.ts) — this runs from background effects with no
 * user gesture, so it must never itself try to pop a consent screen.
 */
export function useUserData({ signedIn, plan, onRemotePlan }: UseUserDataOptions) {
  const [savedLists, setSavedLists] = useState<SavedTaskList[]>([])
  const [targetCalendarId, setTargetCalendarIdState] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<SyncStatus>('idle')

  const initializedRef = useRef(false)
  const loadingRef = useRef(false)
  const skipNextPushRef = useRef(false)
  const pushPendingRef = useRef(false)
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSyncedAtRef = useRef<string | null>(null)

  // Mirrors the latest state into a ref so pushNow/poll (called from
  // effects/timers) always see current values without re-subscribing.
  const stateRef = useRef({ plan, savedLists, targetCalendarId })
  stateRef.current = { plan, savedLists, targetCalendarId }
  loadingRef.current = loading

  const onRemotePlanRef = useRef(onRemotePlan)
  onRemotePlanRef.current = onRemotePlan

  const applyRemote = useCallback((remote: {
    updatedAt: string
    plan: unknown
    savedLists: unknown
    targetCalendarId: unknown
  }) => {
    skipNextPushRef.current = true
    const migrated = migratePlan(remote.plan)
    onRemotePlanRef.current(migrated ?? defaultPlan())
    setSavedLists(normalizeSavedLists(remote.savedLists))
    setTargetCalendarIdState(
      typeof remote.targetCalendarId === 'string' ? remote.targetCalendarId : '',
    )
    lastSyncedAtRef.current = remote.updatedAt
  }, [])

  const pushNow = useCallback(async () => {
    const { plan: p, savedLists: sl, targetCalendarId: tc } = stateRef.current
    const updatedAt = new Date().toISOString()
    await uploadState({ updatedAt, plan: p, savedLists: sl, targetCalendarId: tc })
    lastSyncedAtRef.current = updatedAt
  }, [])

  // Initial fetch, once per sign-in (including a restored session on cold load).
  useEffect(() => {
    if (!signedIn) {
      initializedRef.current = false
      setLoading(false)
      return
    }
    if (initializedRef.current) return
    initializedRef.current = true

    let cancelled = false
    ;(async () => {
      setLoading(true)
      setStatus('syncing')
      try {
        const remote = await downloadState()
        if (cancelled) return
        if (remote) {
          applyRemote(remote)
        } else {
          // Nothing synced yet for this account — seed Drive with the
          // (empty) starting state so this device's next push has a target.
          await pushNow()
          skipNextPushRef.current = true
        }
        if (!cancelled) setStatus('synced')
      } catch {
        if (!cancelled) setStatus('error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [signedIn, applyRemote, pushNow])

  // Debounced push whenever the plan, saved lists, or target calendar change.
  useEffect(() => {
    if (!signedIn || !initializedRef.current || loading) return
    if (skipNextPushRef.current) {
      skipNextPushRef.current = false
      return
    }

    pushPendingRef.current = true
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    pushTimerRef.current = setTimeout(() => {
      pushPendingRef.current = false
      setStatus('syncing')
      pushNow()
        .then(() => setStatus('synced'))
        .catch(() => setStatus('error'))
    }, PUSH_DEBOUNCE_MS)

    return () => {
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    }
  }, [plan, savedLists, targetCalendarId, signedIn, loading, pushNow])

  // Poll for changes from other devices while this tab is open.
  useEffect(() => {
    if (!signedIn) return

    let cancelled = false

    async function checkRemote() {
      if (cancelled || !initializedRef.current || loadingRef.current) return
      // A local edit is about to be pushed — don't risk clobbering it with
      // a stale-looking remote read that raced ahead of our own write.
      if (pushPendingRef.current) return
      try {
        const remote = await downloadState()
        if (cancelled || !remote) return
        const isNewer =
          !lastSyncedAtRef.current ||
          new Date(remote.updatedAt) > new Date(lastSyncedAtRef.current)
        if (isNewer) applyRemote(remote)
      } catch {
        /* best effort — next poll will retry */
      }
    }

    const interval = setInterval(() => void checkRemote(), POLL_INTERVAL_MS)

    function onVisibleOrFocus() {
      if (document.visibilityState === 'hidden') return
      void checkRemote()
    }
    document.addEventListener('visibilitychange', onVisibleOrFocus)
    window.addEventListener('focus', onVisibleOrFocus)

    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibleOrFocus)
      window.removeEventListener('focus', onVisibleOrFocus)
    }
  }, [signedIn, applyRemote])

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

  /** Reset to blank, in-memory only — call on sign-out. */
  const reset = useCallback(() => {
    initializedRef.current = false
    skipNextPushRef.current = false
    pushPendingRef.current = false
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    lastSyncedAtRef.current = null
    setSavedLists([])
    setTargetCalendarIdState('')
    setStatus('idle')
    setLoading(false)
    resetDriveSyncCache()
  }, [])

  return {
    savedLists,
    targetCalendarId,
    loading,
    status,
    saveList,
    deleteList,
    setTargetCalendarId,
    reset,
  }
}
