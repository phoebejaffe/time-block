import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import type { Plan, BlockLibrary } from './tasks'
import { defaultBlockLibrary, normalizeBlockLibrary } from './tasks'
import {
  defaultPlanArchive,
  normalizePlanArchive,
  type PlanArchive,
} from './planArchive'
import type { PushSnapshot, PushedEvent } from './pushedEvents'
import {
  normalizePushSnapshots,
  normalizePushedEvents,
} from './pushedEvents'
import {
  normalizeSavedCalendarUsers,
  type SavedCalendarUser,
} from './savedCalendarUsers'
import {
  defaultUserSettings,
  normalizeUserSettings,
  type UserSettings,
} from './userSettings'
import { getFirestoreDb } from './firebase'

/**
 * Cross-device sync via Firestore — one document per signed-in user.
 * Real-time listeners replace Drive polling; last-write-wins by `updatedAt`.
 *
 * Archived plans live in a separate fragment document so the main user doc
 * can load without parsing/hydrating the archive on sign-in.
 */

export type SyncPayload = {
  updatedAt: string
  plan: Plan
  blockLibrary: BlockLibrary
  targetCalendarId: string
  pushedEvents: PushedEvent[]
  pushSnapshots: PushSnapshot[]
  /** Group currently being executed, if any. */
  executingGroupId: string | null
  savedCalendarUsers: SavedCalendarUser[]
  settings: UserSettings
}

export type UserStateSnapshot = SyncPayload & {
  /** Inline archive on older documents — migrate to the fragment, then ignore. */
  legacyPlanArchive?: unknown
}

export type PlanArchiveSyncPayload = {
  updatedAt: string
  planArchive: PlanArchive
}

class UserDataSyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserDataSyncError'
  }
}

function userDocRef(uid: string) {
  return doc(getFirestoreDb(), 'users', uid)
}

function planArchiveDocRef(uid: string) {
  return doc(getFirestoreDb(), 'users', uid, 'fragments', 'planArchive')
}

/** Live updates for this user's synced state (including the initial snapshot). */
export function subscribeUserState(
  uid: string,
  onData: (payload: UserStateSnapshot | null) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    userDocRef(uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null)
        return
      }
      const data = snap.data() as Partial<SyncPayload> & { planArchive?: unknown }
      if (!data.updatedAt || !data.plan) {
        onData(null)
        return
      }
      onData({
        updatedAt: data.updatedAt,
        plan: data.plan as Plan,
        blockLibrary:
          data.blockLibrary != null
            ? normalizeBlockLibrary(data.blockLibrary)
            : defaultBlockLibrary(),
        targetCalendarId:
          typeof data.targetCalendarId === 'string' ? data.targetCalendarId : '',
        pushedEvents: normalizePushedEvents(data.pushedEvents),
        pushSnapshots: normalizePushSnapshots(data.pushSnapshots),
        executingGroupId:
          typeof data.executingGroupId === 'string' && data.executingGroupId
            ? data.executingGroupId
            : null,
        savedCalendarUsers: normalizeSavedCalendarUsers(data.savedCalendarUsers),
        settings:
          data.settings != null
            ? normalizeUserSettings(data.settings)
            : defaultUserSettings(),
        legacyPlanArchive: data.planArchive,
      })
    },
    (err) => onError(err instanceof Error ? err : new Error(String(err))),
  )
}

/** Create or overwrite the user's synced state document. */
export async function saveUserState(
  uid: string,
  payload: SyncPayload,
): Promise<void> {
  try {
    await setDoc(userDocRef(uid), payload)
  } catch (err) {
    throw new UserDataSyncError(
      err instanceof Error ? err.message : 'Could not save to Firestore',
    )
  }
}

/** One-time read of the archived-plans fragment (null when missing). */
export async function fetchPlanArchive(
  uid: string,
): Promise<PlanArchiveSyncPayload | null> {
  const snap = await getDoc(planArchiveDocRef(uid))
  if (!snap.exists()) return null
  const data = snap.data() as Partial<PlanArchiveSyncPayload>
  if (!data.updatedAt) return null
  return {
    updatedAt: data.updatedAt,
    planArchive:
      data.planArchive != null
        ? normalizePlanArchive(data.planArchive)
        : defaultPlanArchive(),
  }
}

/** Live updates for archived plans (including the initial snapshot). */
export function subscribePlanArchive(
  uid: string,
  onData: (payload: PlanArchiveSyncPayload | null) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    planArchiveDocRef(uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null)
        return
      }
      const data = snap.data() as Partial<PlanArchiveSyncPayload>
      if (!data.updatedAt) {
        onData(null)
        return
      }
      onData({
        updatedAt: data.updatedAt,
        planArchive:
          data.planArchive != null
            ? normalizePlanArchive(data.planArchive)
            : defaultPlanArchive(),
      })
    },
    (err) => onError(err instanceof Error ? err : new Error(String(err))),
  )
}

/** Create or overwrite the archived-plans fragment document. */
export async function savePlanArchive(
  uid: string,
  payload: PlanArchiveSyncPayload,
): Promise<void> {
  try {
    await setDoc(planArchiveDocRef(uid), payload)
  } catch (err) {
    throw new UserDataSyncError(
      err instanceof Error ? err.message : 'Could not save archived plans',
    )
  }
}

/** Copy inline archive from a legacy user doc into the fragment when needed. */
export async function migrateLegacyPlanArchive(
  uid: string,
  legacy: unknown,
  save: typeof savePlanArchive = savePlanArchive,
): Promise<void> {
  const existing = await fetchPlanArchive(uid)
  if (existing) return
  const planArchive = normalizePlanArchive(legacy)
  await save(uid, {
    updatedAt: planArchive.updatedAt || new Date().toISOString(),
    planArchive,
  })
}
