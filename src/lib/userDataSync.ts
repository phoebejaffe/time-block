import {
  doc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import type { Plan, BlockLibrary } from './tasks'
import { defaultBlockLibrary, normalizeBlockLibrary } from './tasks'
import type { PushSnapshot, PushedEvent } from './pushedEvents'
import {
  normalizePushSnapshots,
  normalizePushedEvents,
} from './pushedEvents'
import { getFirestoreDb } from './firebase'

/**
 * Cross-device sync via Firestore — one document per signed-in user.
 * Real-time listeners replace Drive polling; last-write-wins by `updatedAt`.
 */

export type SyncPayload = {
  updatedAt: string
  plan: Plan
  blockLibrary: BlockLibrary
  targetCalendarId: string
  pushedEvents: PushedEvent[]
  pushSnapshots: PushSnapshot[]
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

/** Live updates for this user's synced state (including the initial snapshot). */
export function subscribeUserState(
  uid: string,
  onData: (payload: SyncPayload | null) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    userDocRef(uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null)
        return
      }
      const data = snap.data() as Partial<SyncPayload>
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
