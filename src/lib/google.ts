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
/** Backend refresh calls should be fast; don't let them hang the app. */
const REFRESH_TIMEOUT_MS = 10_000
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

/** Link the Google OAuth session to Firebase Auth for Firestore access. */
async function signInToFirebase(
  idToken: string | undefined,
  accessToken: string,
): Promise<void> {
  if (!isFirebaseConfigured()) return
  if (!idToken) {
    throw new Error(
      'Google sign-in did not return an ID token. Sign out, then sign in again.',
    )
  }
  const credential = GoogleAuthProvider.credential(idToken, accessToken)
  await signInWithCredential(getFirebaseAuth(), credential)
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
  return Boolean(gapi.client.getToken()?.access_token)
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
  await signInToFirebase(payload.id_token, session.access_token)
  return session
}

/**
 * Mint a new access token from the stored refresh token. No user gesture
 * needed, works on cold loads and on Safari/iOS. Returns false when there is
 * no refresh token or it has been revoked (user must sign in again).
 */
async function refreshAccessToken(): Promise<boolean> {
  const session = readStoredSession()
  const refreshToken = session?.refresh_token
  if (!refreshToken) return false

  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      const payload = await postAuth(
        '/refresh',
        { refresh_token: refreshToken },
        REFRESH_TIMEOUT_MS,
      )
      if (!payload.access_token) return false
      const next = persistTokenPayload({
        ...payload,
        refresh_token: refreshToken,
      })
      setGapiToken(next.access_token)
      return true
    } catch (err) {
      // 401 → refresh token revoked or expired; require a fresh sign-in.
      if ((err as { status?: number }).status === 401) {
        clearStoredSession()
      }
      return false
    } finally {
      refreshInFlight = null
    }
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
  void maybeRefreshTokenQuietly()
}

function stopTokenRefreshLoop(): void {
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
  refreshTimer = setInterval(() => {
    void maybeRefreshTokenQuietly()
  }, REFRESH_CHECK_MS)
  document.addEventListener('visibilitychange', onVisibilityOrFocusRefresh)
  window.addEventListener('focus', onVisibilityOrFocusRefresh)
  void maybeRefreshTokenQuietly()
}

async function maybeRefreshTokenQuietly(): Promise<boolean> {
  const session = readStoredSession()
  if (!session) return false

  const msLeft = session.expires_at - Date.now()
  if (msLeft > REFRESH_BEFORE_MS) return true

  return refreshAccessToken()
}

/**
 * Restore a previous session after refresh / revisit.
 * Reuses a still-valid stored access token, otherwise mints a new one from
 * the stored refresh token — so returning users stay signed in without a click.
 */
export function restoreSession(): Promise<boolean> {
  if (!restorePromise) {
    restorePromise = (async () => {
      await initGoogle()

      const session = readStoredSession()
      if (!session) return false

      if (Date.now() < session.expires_at) {
        setGapiToken(session.access_token)
        applyScopes(session.scope)
        startTokenRefreshLoop()
        return true
      }

      if (await refreshAccessToken()) {
        startTokenRefreshLoop()
        return true
      }
      return false
    })()
  }
  return restorePromise
}

/**
 * Sign in with calendar read access (user-initiated only). Also requests
 * OpenID scopes so the backend can return an ID token for Firebase Auth.
 */
export async function signIn(): Promise<void> {
  await initGoogle()
  const code = await requestAuthCode(`${READ_SCOPES} ${OPENID_SCOPES}`)
  await exchangeCode(code)
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
