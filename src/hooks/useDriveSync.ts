import { useEffect, useRef, useState } from 'react'
import { downloadState, uploadState } from '../lib/driveSync'
import { ensureDriveScope } from '../lib/google'
import {
  loadSavedLists,
  loadTargetCalendarId,
  migratePlan,
  replaceSavedLists,
  saveTargetCalendarId,
  type Plan,
} from '../lib/tasks'

const SYNCED_AT_KEY = 'time-blocking.plan-synced-at'
/** Wait for a pause in edits before pushing — most edits arrive in bursts. */
const PUSH_DEBOUNCE_MS = 2_000

export type DriveSyncStatus = 'idle' | 'syncing' | 'synced' | 'error'

type UseDriveSyncOptions = {
  signedIn: boolean
  plan: Plan
  onRemotePlan: (plan: Plan) => void
  /** Bumped whenever saved lists or the target calendar change locally. */
  userDataVersion: number
  /** Called after a remote pull applies saved lists / target calendar. */
  onRemoteUserData: () => void
}

/**
 * Cross-device sync via the user's own Drive appDataFolder. Covers the plan,
 * saved lists, and target-calendar choice as one small JSON file. On
 * sign-in, pulls the most recently synced copy (by `updatedAt`) if it's
 * newer than what this device last synced; otherwise pushes local state.
 * After that, local edits are pushed with a short debounce. Best effort
 * throughout — sync failures never block using the app offline.
 */
export function useDriveSync({
  signedIn,
  plan,
  onRemotePlan,
  userDataVersion,
  onRemoteUserData,
}: UseDriveSyncOptions) {
  const [status, setStatus] = useState<DriveSyncStatus>('idle')
  const initializedRef = useRef(false)
  const skipNextPushRef = useRef(false)
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const planRef = useRef(plan)
  const onRemotePlanRef = useRef(onRemotePlan)
  const onRemoteUserDataRef = useRef(onRemoteUserData)
  planRef.current = plan
  onRemotePlanRef.current = onRemotePlan
  onRemoteUserDataRef.current = onRemoteUserData

  async function pushNow(planToPush: Plan): Promise<void> {
    const updatedAt = new Date().toISOString()
    await uploadState({
      updatedAt,
      plan: planToPush,
      savedLists: loadSavedLists(),
      targetCalendarId: loadTargetCalendarId(),
    })
    localStorage.setItem(SYNCED_AT_KEY, updatedAt)
  }

  // One pull-or-push per sign-in (including a restored session on cold load).
  useEffect(() => {
    if (!signedIn) {
      initializedRef.current = false
      return
    }
    if (initializedRef.current) return
    initializedRef.current = true

    let cancelled = false
    ;(async () => {
      setStatus('syncing')
      try {
        await ensureDriveScope()
        const remote = await downloadState()
        if (cancelled) return

        const localSyncedAt = localStorage.getItem(SYNCED_AT_KEY)
        const remoteIsNewer =
          remote?.updatedAt != null &&
          (!localSyncedAt || new Date(remote.updatedAt) > new Date(localSyncedAt))

        if (remoteIsNewer) {
          skipNextPushRef.current = true

          const migrated = migratePlan(remote!.plan)
          if (migrated) onRemotePlanRef.current(migrated)
          replaceSavedLists(remote!.savedLists)
          if (typeof remote!.targetCalendarId === 'string') {
            saveTargetCalendarId(remote!.targetCalendarId)
          }
          onRemoteUserDataRef.current()

          localStorage.setItem(SYNCED_AT_KEY, remote!.updatedAt)
        } else {
          await pushNow(planRef.current)
        }
        if (!cancelled) setStatus('synced')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [signedIn])

  // Debounced push whenever the plan or user data changes locally.
  useEffect(() => {
    if (!signedIn || !initializedRef.current) return
    if (skipNextPushRef.current) {
      skipNextPushRef.current = false
      return
    }

    if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    pushTimerRef.current = setTimeout(() => {
      setStatus('syncing')
      pushNow(plan)
        .then(() => setStatus('synced'))
        .catch(() => setStatus('error'))
    }, PUSH_DEBOUNCE_MS)

    return () => {
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pushNow is stable-enough via refs
  }, [plan, userDataVersion, signedIn])

  return { status }
}
