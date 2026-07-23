import type { Plan, SavedTaskList } from './tasks'

/**
 * Cross-device sync via Google Drive's hidden "app data" folder — a
 * per-app private storage area in the user's own Drive, invisible in their
 * file list. One small JSON file holds the plan, saved lists, and the
 * target-calendar choice; last-write-wins by `updatedAt`. See
 * server/README.md / lib/google.ts for the `drive.appdata` scope this
 * depends on.
 */

const FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
const STATE_FILE_NAME = 'time-blocking-state.json'
const FILE_ID_CACHE_KEY = 'time-blocking.drive-file-id'
const BOUNDARY = 'time_blocking_sync_boundary'

export type SyncPayload = {
  updatedAt: string
  plan: Plan
  savedLists: SavedTaskList[]
  targetCalendarId: string
}

class DriveSyncError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function authHeaders(): Record<string, string> {
  const token = gapi.client.getToken()?.access_token
  if (!token) throw new Error('Not signed in')
  return { Authorization: `Bearer ${token}` }
}

function cachedFileId(): string | null {
  return localStorage.getItem(FILE_ID_CACHE_KEY)
}

function setCachedFileId(id: string | null): void {
  if (id) localStorage.setItem(FILE_ID_CACHE_KEY, id)
  else localStorage.removeItem(FILE_ID_CACHE_KEY)
}

async function findFileId(): Promise<string | null> {
  const cached = cachedFileId()
  if (cached) return cached

  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name='${STATE_FILE_NAME}' and trashed=false`,
    fields: 'files(id)',
    pageSize: '1',
  })
  const resp = await fetch(`${FILES_URL}?${params.toString()}`, {
    headers: authHeaders(),
  })
  if (!resp.ok) {
    throw new DriveSyncError(`Drive list failed (${resp.status})`, resp.status)
  }
  const data = (await resp.json()) as { files?: Array<{ id: string }> }
  const id = data.files?.[0]?.id ?? null
  setCachedFileId(id)
  return id
}

function buildMultipartBody(payload: SyncPayload, includeParents: boolean): string {
  const metadata: Record<string, unknown> = { mimeType: 'application/json' }
  if (includeParents) {
    metadata.name = STATE_FILE_NAME
    metadata.parents = ['appDataFolder']
  }
  return (
    `--${BOUNDARY}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${BOUNDARY}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${JSON.stringify(payload)}\r\n` +
    `--${BOUNDARY}--`
  )
}

/** Fetch the synced plan, or null if nothing has been synced yet. */
export async function downloadState(): Promise<SyncPayload | null> {
  const fileId = await findFileId()
  if (!fileId) return null

  const resp = await fetch(`${FILES_URL}/${fileId}?alt=media`, {
    headers: authHeaders(),
  })
  if (resp.status === 404) {
    setCachedFileId(null)
    return null
  }
  if (!resp.ok) {
    throw new DriveSyncError(`Drive download failed (${resp.status})`, resp.status)
  }
  const text = await resp.text()
  if (!text) return null
  try {
    return JSON.parse(text) as SyncPayload
  } catch {
    return null
  }
}

/** Create or update the synced plan file. */
export async function uploadState(payload: SyncPayload): Promise<void> {
  let fileId = await findFileId()
  const body = buildMultipartBody(payload, !fileId)
  const url = fileId
    ? `${UPLOAD_URL}/${fileId}?uploadType=multipart`
    : `${UPLOAD_URL}?uploadType=multipart&fields=id`

  const resp = await fetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': `multipart/related; boundary=${BOUNDARY}`,
    },
    body,
  })

  if (resp.status === 404 && fileId) {
    // Cached id went stale (file removed elsewhere); retry as a fresh create.
    setCachedFileId(null)
    fileId = null
    await uploadState(payload)
    return
  }
  if (!resp.ok) {
    throw new DriveSyncError(`Drive upload failed (${resp.status})`, resp.status)
  }
  if (!fileId) {
    const data = (await resp.json()) as { id?: string }
    setCachedFileId(data.id ?? null)
  }
}
