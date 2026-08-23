import { GoogleAuthProvider, signInWithCredential, signOut as firebaseSignOut } from 'firebase/auth'
import { getFirebaseAuth, isFirebaseConfigured } from './firebase'

const READ_SCOPES = 'https://www.googleapis.com/auth/calendar.readonly'
const WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
/** Needed so the token exchange returns an ID token for Firebase Auth. */
const OPENID_SCOPES = 'openid email profile'
const DISCOVERY_DOC =
  'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'

const SESSION_KEY = 'time-blocking.google-session'
const REMEMBER_KEY = 'time-blocking.google-remember'

/** Deployed token-exchange function (see server/README.md). */
const AUTH_ENDPOINT_FALLBACK =
  'https://us-west1-time-blocker-502417.cloudfunctions.net/auth'

/** Refresh a few minutes before Google's ~1h access token expires. */
const REFRESH_BEFORE_MS = 5 * 60_000
const REFRESH_CHECK_MS = 60_000
/** Quiet in-tab refreshes should be snappy. */
const REFRESH_TIMEOUT_MS = 15_000
/**
 * Boot restore may hit a cold Cloud Function after a day away — give it longer
 * and retry before forcing the user through OAuth again.
 */
const BOOT_REFRESH_TIMEOUT_MS = 45_000
const BOOT_REFRESH_ATTEMPTS = 3
const BOOT_REFRESH_RETRY_DELAY_MS = 1_500
/** Interactive login can wait for the popup. */
const INTERACTIVE_AUTH_TIMEOUT_MS = 5 * 60_000

type StoredSession = {
  access_token: string
  expires_at: number
  scope: string
  refresh_token?: string
}

type TokenPayload = {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  id_token?: string
  error?: string
  error_description?: string
}

/** Must match the OAuth client ID on the deployed auth backend. */
const PRODUCTION_CLIENT_ID =
  '597708660954-lcc1jjlb2da9ffkgj3viaa5arkt4ktqj.apps.googleusercontent.com'

function getClientId(): string {
  if (import.meta.env.DEV) {
    const id = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
    if (!id || id.includes('your-client-id')) {
      throw new Error(
        'Missing VITE_GOOGLE_CLIENT_ID. Copy .env.example to .env and set your OAuth client ID.',
      )
    }
    return id
  }
  return PRODUCTION_CLIENT_ID
}

function getAuthEndpoint(): string {
  const url = import.meta.env.VITE_AUTH_ENDPOINT as string | undefined
  return (url || AUTH_ENDPOINT_FALLBACK).replace(/\/+$/, '')
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`,
    )
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () =>
        reject(new Error(`Failed to load ${src}`)),
      )
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.defer = true
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true'
      resolve()
    })
    script.addEventListener('error', () =>
      reject(new Error(`Failed to load ${src}`)),
    )
    document.head.appendChild(script)
  })
}

let gapiReady = false
let gisReady = false
let grantedScopes = new Set<string>()
let initPromise: Promise<void> | null = null
let restorePromise: Promise<boolean> | null = null
let refreshTimer: ReturnType<typeof setInterval> | null = null
let refreshInFlight: Promise<boolean> | null = null
let refreshLoopActive = false
let restoreAttempted = false
let restoreSucceeded = false
let restoreDetail: string | null = null
let lastRefresh: {
  at: string
  source: RefreshAttemptSource
  ok: boolean
  error: string | null
  durationMs: number
} | null = null

export type RefreshAttemptSource = 'boot' | 'timer' | 'focus' | 'manual'

export type SessionDiagnostics = {
  hasStoredSession: boolean
  hasRefreshToken: boolean
  hasAccessToken: boolean
  /** True when a refresh token is stored but restore failed — recoverable without full OAuth. */
  canRecoverWithoutOauth: boolean
  accessExpiresAt: number | null
  msUntilAccessExpiry: number | null
  refreshLoopActive: boolean
  restoreAttempted: boolean
  restoreSucceeded: boolean
  restoreDetail: string | null
  lastRefreshAt: string | null
  lastRefreshSource: RefreshAttemptSource | null
  lastRefreshOk: boolean | null
  lastRefreshError: string | null
  lastRefreshMs: number | null
  authEndpoint: string
  /** Checks every 60s; refreshes when access token has ≤5 min left. */
  refreshCheckIntervalMs: number
  refreshBeforeExpiryMs: number
}

function recordRefreshAttempt(
  source: RefreshAttemptSource,
  ok: boolean,
  error: string | null,
  durationMs: number,
): void {
  lastRefresh = {
    at: new Date().toISOString(),
    source,
    ok,
    error,
    durationMs,
  }
}

function refreshErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function getSessionDiagnostics(): SessionDiagnostics {
  const session = readStoredSession()
  const expiresAt = session?.expires_at ?? null
  const msUntil =
    expiresAt != null ? Math.max(0, expiresAt - Date.now()) : null
  const hasRefreshToken = Boolean(session?.refresh_token)
  return {
    hasStoredSession: Boolean(session),
    hasRefreshToken,
    hasAccessToken: hasAccessToken(),
    canRecoverWithoutOauth:
      hasRefreshToken && restoreAttempted && !restoreSucceeded,
    accessExpiresAt: expiresAt,
    msUntilAccessExpiry: msUntil,
    refreshLoopActive,
    restoreAttempted,
    restoreSucceeded,
    restoreDetail,
    lastRefreshAt: lastRefresh?.at ?? null,
    lastRefreshSource: lastRefresh?.source ?? null,
    lastRefreshOk: lastRefresh?.ok ?? null,
    lastRefreshError: lastRefresh?.error ?? null,
    lastRefreshMs: lastRefresh?.durationMs ?? null,
    authEndpoint: getAuthEndpoint(),
    refreshCheckIntervalMs: REFRESH_CHECK_MS,
    refreshBeforeExpiryMs: REFRESH_BEFORE_MS,
  }
}

function applyScopes(scope: string): void {
  for (const s of scope.split(/\s+/).filter(Boolean)) {
    grantedScopes.add(s)
  }
}

/** Union scope strings so incremental auth never drops previously granted scopes. */
export function mergeScopeStrings(...parts: Array<string | undefined>): string {
  const scopes = new Set<string>()
  for (const part of parts) {
    for (const scope of part?.split(/\s+/).filter(Boolean) ?? []) {
      scopes.add(scope)
    }
  }
  return [...scopes].join(' ')
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSession
    if (!parsed.access_token || !parsed.expires_at) return null
    return parsed
  } catch {
    return null
  }
}

function writeStoredSession(session: StoredSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  localStorage.setItem(REMEMBER_KEY, '1')
  applyScopes(session.scope)
}

/** Persist a token payload; keeps the previous refresh token if not reissued. */
function persistTokenPayload(payload: TokenPayload): StoredSession {
  const previous = readStoredSession()
  const expiresInSec = Number(payload.expires_in) || 3600
  const scope = mergeScopeStrings(previous?.scope, payload.scope, READ_SCOPES)
  const session: StoredSession = {
    access_token: payload.access_token || '',
    // Refresh a minute early to avoid edge-of-expiry API failures.
    expires_at: Date.now() + expiresInSec * 1000 - 60_000,
    scope,
    ...(payload.refresh_token || previous?.refresh_token
      ? { refresh_token: payload.refresh_token || previous?.refresh_token }
      : {}),
  }
  writeStoredSession(session)
  return session
}

function clearStoredSession(): void {
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(REMEMBER_KEY)
}

function setGapiToken(accessToken: string): void {
  gapi.client.setToken({ access_token: accessToken })
}

/**
 * Link the Google OAuth session to Firebase Auth for Firestore access.
 * Interactive sign-in provides an ID token; silent restore/refresh only has
 * an access token — Firebase accepts either.
 */
async function signInToFirebase(
  idToken: string | undefined,
  accessToken: string,
  { requireIdToken = false }: { requireIdToken?: boolean } = {},
): Promise<void> {
  if (!isFirebaseConfigured()) return
  if (!idToken && !accessToken) {
    throw new Error('Missing Google credentials for Firebase sign-in.')
  }
  if (requireIdToken && !idToken) {
    throw new Error(
      'Google sign-in did not return an ID token. Sign out, then sign in again.',
    )
  }
  const credential = GoogleAuthProvider.credential(
    idToken || null,
    accessToken || null,
  )
  await signInWithCredential(getFirebaseAuth(), credential)
}

function readGoogleAccessToken(): string | undefined {
  const session = readStoredSession()
  if (session?.access_token && Date.now() < session.expires_at) {
    return session.access_token
  }
  if (gapiReady && typeof gapi !== 'undefined') {
    try {
      return gapi.client.getToken()?.access_token
    } catch {
      /* gapi not fully ready yet */
    }
  }
  return session?.access_token
}

/** Ensure Firebase is signed in after a silent Google token restore/refresh. */
async function ensureFirebaseSession(accessToken: string): Promise<void> {
  if (!isFirebaseConfigured()) return
  const auth = getFirebaseAuth()
  if (auth.currentUser) return
  try {
    await signInToFirebase(undefined, accessToken)
  } catch (err) {
    // Don't fail Google Calendar restore if Firebase re-auth hiccups —
    // the UI can still recover; surface via console for diagnostics.
    console.warn('Firebase silent re-auth failed:', err)
  }
}

/** Retry linking Firestore auth from the active Google OAuth session. */
export async function linkFirebaseFromGoogleSession(): Promise<boolean> {
  if (!isFirebaseConfigured()) return false
  const auth = getFirebaseAuth()
  if (auth.currentUser) return true
  const accessToken = readGoogleAccessToken()
  if (!accessToken) return false
  await signInToFirebase(undefined, accessToken)
  return Boolean(auth.currentUser)
}

async function signOutFirebase(): Promise<void> {
  if (!isFirebaseConfigured()) return
  await firebaseSignOut(getFirebaseAuth())
}

async function ensureGapi(): Promise<void> {
  await loadScript('https://apis.google.com/js/api.js')
  await new Promise<void>((resolve, reject) => {
    gapi.load('client', {
      callback: () => resolve(),
      onerror: () => reject(new Error('Failed to load gapi.client')),
    })
  })
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined
  await gapi.client.init({
    apiKey: apiKey || undefined,
    discoveryDocs: [DISCOVERY_DOC],
  })
  gapiReady = true
}

async function ensureGis(): Promise<void> {
  await loadScript('https://accounts.google.com/gsi/client')
  gisReady = true
}

export function initGoogle(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await Promise.all([ensureGapi(), ensureGis()])
    })().catch((err) => {
      initPromise = null
      throw err
    })
  }
  return initPromise
}

export function isGoogleReady(): boolean {
  return gapiReady && gisReady
}

export function hasAccessToken(): boolean {
  if (gapiReady && typeof gapi !== 'undefined') {
    try {
      if (gapi.client.getToken()?.access_token) return true
    } catch {
      /* gapi not fully ready yet */
    }
  }
  const session = readStoredSession()
  return Boolean(session && Date.now() < session.expires_at)
}

/**
 * Open the GIS popup and get a one-time authorization code.
 * The code flow always shows consent, which makes Google reissue a
 * refresh token — that's what keeps users signed in long-term.
 */
function requestAuthCode(scope: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('Authorization timed out'))
    }, INTERACTIVE_AUTH_TIMEOUT_MS)

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    try {
      const client = google.accounts.oauth2.initCodeClient({
        client_id: getClientId(),
        scope,
        include_granted_scopes: true,
        ux_mode: 'popup',
        callback: (response) => {
          finish(() => {
            if (response.error) {
              reject(
                new Error(
                  response.error_description ||
                    response.error ||
                    'Authorization failed',
                ),
              )
              return
            }
            resolve(response.code)
          })
        },
        error_callback: (err) => {
          const message =
            (err && typeof err === 'object' && 'message' in err
              ? String((err as { message?: string }).message)
              : null) ||
            (err && typeof err === 'object' && 'type' in err
              ? String((err as { type?: string }).type)
              : null) ||
            'Authorization failed'
          finish(() => reject(new Error(message)))
        },
      })
      client.requestCode()
    } catch (err) {
      finish(() =>
        reject(err instanceof Error ? err : new Error(String(err))),
      )
    }
  })
}

async function postAuth(
  path: '/exchange' | '/refresh' | '/revoke',
  body: Record<string, string>,
  timeoutMs?: number,
): Promise<TokenPayload> {
  const controller = new AbortController()
  const timer = timeoutMs
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null
  try {
    const resp = await fetch(`${getAuthEndpoint()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const data = (await resp.json().catch(() => ({}))) as TokenPayload
    if (!resp.ok) {
      let message =
        data.error_description || data.error || `Auth request failed (${resp.status})`
      if (data.error === 'unauthorized_client') {
        message =
          'OAuth client mismatch: the auth backend client ID must match VITE_GOOGLE_CLIENT_ID in .env.'
      }
      const error = new Error(message) as Error & { status?: number }
      error.status = resp.status
      throw error
    }
    return data
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Exchange a popup auth code for tokens via the backend. */
async function exchangeCode(code: string): Promise<StoredSession> {
  const payload = await postAuth('/exchange', { code })
  if (!payload.access_token) {
    throw new Error('Token exchange returned no access token')
  }
  const session = persistTokenPayload(payload)
  setGapiToken(session.access_token)
  await signInToFirebase(payload.id_token, session.access_token, {
    requireIdToken: true,
  })
  return session
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && /abort/i.test(err.message))
  )
}

/**
 * Mint a new access token from the stored refresh token. No user gesture
 * needed, works on cold loads and on Safari/iOS. Returns false when there is
 * no refresh token or it has been revoked (user must sign in again).
 */
async function refreshAccessToken(
  source: RefreshAttemptSource,
): Promise<boolean> {
  const session = readStoredSession()
  const refreshToken = session?.refresh_token
  if (!refreshToken) {
    recordRefreshAttempt(source, false, 'No refresh token stored', 0)
    return false
  }

  if (refreshInFlight) return refreshInFlight

  const attempts =
    source === 'boot' || source === 'manual' ? BOOT_REFRESH_ATTEMPTS : 1
  const timeoutMs =
    source === 'boot' || source === 'manual'
      ? BOOT_REFRESH_TIMEOUT_MS
      : REFRESH_TIMEOUT_MS

  refreshInFlight = (async () => {
    const started = Date.now()
    let lastError: string | null = null

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const payload = await postAuth(
          '/refresh',
          { refresh_token: refreshToken },
          timeoutMs,
        )
        if (!payload.access_token) {
          lastError = 'Backend returned no access token'
          recordRefreshAttempt(
            source,
            false,
            lastError,
            Date.now() - started,
          )
          return false
        }
        const next = persistTokenPayload({
          ...payload,
          refresh_token: refreshToken,
        })
        setGapiToken(next.access_token)
        void ensureFirebaseSession(next.access_token)
        recordRefreshAttempt(source, true, null, Date.now() - started)
        return true
      } catch (err) {
        const message = isAbortError(err)
          ? `Refresh timed out after ${timeoutMs / 1000}s (backend may be cold-starting)`
          : refreshErrorMessage(err)
        lastError = message

        // 401 → refresh token revoked or expired; require a fresh sign-in.
        if ((err as { status?: number }).status === 401) {
          clearStoredSession()
          recordRefreshAttempt(
            source,
            false,
            `Refresh rejected (401): ${message}`,
            Date.now() - started,
          )
          return false
        }

        if (attempt < attempts) {
          await sleep(BOOT_REFRESH_RETRY_DELAY_MS * attempt)
          continue
        }

        recordRefreshAttempt(
          source,
          false,
          attempts > 1
            ? `${message} (after ${attempts} attempts)`
            : message,
          Date.now() - started,
        )
        return false
      }
    }

    recordRefreshAttempt(source, false, lastError, Date.now() - started)
    return false
  })()

  return refreshInFlight
}

function onVisibilityOrFocusRefresh(): void {
  if (
    typeof document !== 'undefined' &&
    document.visibilityState === 'hidden'
  ) {
    return
  }
  void maybeRefreshTokenQuietly('focus')
}

function stopTokenRefreshLoop(): void {
  refreshLoopActive = false
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  document.removeEventListener('visibilitychange', onVisibilityOrFocusRefresh)
  window.removeEventListener('focus', onVisibilityOrFocusRefresh)
}

/**
 * While the tab stays open, refresh before expiry via the backend.
 * Also refreshes when the tab becomes visible again (background timers throttle).
 */
function startTokenRefreshLoop(): void {
  stopTokenRefreshLoop()
  refreshLoopActive = true
  refreshTimer = setInterval(() => {
    void maybeRefreshTokenQuietly('timer')
  }, REFRESH_CHECK_MS)
  document.addEventListener('visibilitychange', onVisibilityOrFocusRefresh)
  window.addEventListener('focus', onVisibilityOrFocusRefresh)
  void maybeRefreshTokenQuietly('timer')
}

async function maybeRefreshTokenQuietly(
  source: RefreshAttemptSource,
): Promise<boolean> {
  const session = readStoredSession()
  if (!session) return false

  const msLeft = session.expires_at - Date.now()
  if (msLeft > REFRESH_BEFORE_MS) return true

  return refreshAccessToken(source)
}

/**
 * Restore a previous session after refresh / revisit.
 * Reuses a still-valid stored access token, otherwise mints a new one from
 * the stored refresh token — so returning users stay signed in without a click.
 */
async function activateRestoredSession(
  session: StoredSession,
  detail: string,
): Promise<true> {
  setGapiToken(session.access_token)
  applyScopes(session.scope)
  void ensureFirebaseSession(session.access_token)
  startTokenRefreshLoop()
  restoreSucceeded = true
  restoreDetail = detail
  return true
}

export function restoreSession(): Promise<boolean> {
  if (!restorePromise) {
    restorePromise = (async () => {
      restoreAttempted = true
      restoreSucceeded = false
      restoreDetail = null
      await initGoogle()

      const session = readStoredSession()
      if (!session) {
        restoreDetail = 'No saved session in localStorage'
        return false
      }

      if (Date.now() < session.expires_at) {
        return activateRestoredSession(
          session,
          'Restored with a still-valid access token',
        )
      }

      if (await refreshAccessToken('boot')) {
        const next = readStoredSession()
        if (next) {
          return activateRestoredSession(
            next,
            'Restored by refreshing the access token after it expired',
          )
        }
      }

      restoreDetail =
        lastRefresh?.error ||
        (session.refresh_token
          ? 'Access token expired and refresh failed — try “Recover session” (full Google consent usually not needed)'
          : 'Access token expired and no refresh token stored')
      return false
    })()
  }
  return restorePromise
}

/**
 * Force a refresh now (for diagnostics / recovering after a failed boot
 * restore without re-running the full Google OAuth consent popup).
 */
export async function testRefreshNow(): Promise<boolean> {
  await initGoogle()
  // Allow another restore attempt after a manual recovery.
  restorePromise = null
  const ok = await refreshAccessToken('manual')
  if (!ok) return false
  const session = readStoredSession()
  if (!session) return false
  await activateRestoredSession(
    session,
    'Recovered by refreshing the access token',
  )
  restoreAttempted = true
  restorePromise = Promise.resolve(true)
  return true
}

/**
 * Sign in with calendar read access (user-initiated only). Also requests
 * OpenID scopes so the backend can return an ID token for Firebase Auth.
 */
export async function signIn(): Promise<void> {
  await initGoogle()
  const code = await requestAuthCode(`${READ_SCOPES} ${OPENID_SCOPES}`)
  await exchangeCode(code)
  restoreAttempted = true
  restoreSucceeded = true
  restoreDetail = 'Signed in with Google'
  restorePromise = Promise.resolve(true)
  startTokenRefreshLoop()
}

/** Request write scope (incremental) when committing tasks to a calendar. */
export async function ensureWriteScope(): Promise<void> {
  await initGoogle()
  if (grantedScopes.has(WRITE_SCOPE)) return
  const code = await requestAuthCode(`${READ_SCOPES} ${WRITE_SCOPE} ${OPENID_SCOPES}`)
  await exchangeCode(code)
  startTokenRefreshLoop()
}

export function signOut(): void {
  stopTokenRefreshLoop()
  restoreAttempted = false
  restoreSucceeded = false
  restoreDetail = null
  lastRefresh = null

  const session = readStoredSession()
  if (session?.refresh_token) {
    // Revoking the refresh token also invalidates its access tokens.
    void postAuth('/revoke', { token: session.refresh_token }).catch(() => {})
  } else {
    const token = gapi.client.getToken()
    if (token?.access_token) {
      google.accounts.oauth2.revoke(token.access_token, () => {})
    }
  }

  void signOutFirebase()

  gapi.client.setToken(null)
  grantedScopes.clear()
  clearStoredSession()
  restorePromise = Promise.resolve(false)
}

export { READ_SCOPES, WRITE_SCOPE, OPENID_SCOPES }
