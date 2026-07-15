const READ_SCOPES = 'https://www.googleapis.com/auth/calendar.readonly'
const WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const DISCOVERY_DOC =
  'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'

const SESSION_KEY = 'time-blocking.google-session'
const REMEMBER_KEY = 'time-blocking.google-remember'

/** Refresh a few minutes before Google's ~1h access token expires. */
const REFRESH_BEFORE_MS = 5 * 60_000
const REFRESH_CHECK_MS = 60_000

type StoredSession = {
  access_token: string
  expires_at: number
  scope: string
}

function getClientId(): string {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  if (!id || id.includes('your-client-id')) {
    throw new Error(
      'Missing VITE_GOOGLE_CLIENT_ID. Copy .env.example to .env and set your OAuth client ID.',
    )
  }
  return id
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
let tokenClient: google.accounts.oauth2.TokenClient | null = null
let tokenCallback:
  | ((response: google.accounts.oauth2.TokenResponse) => void)
  | null = null
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

function persistSession(
  response: google.accounts.oauth2.TokenResponse,
): void {
  const expiresInSec = Number(response.expires_in) || 3600
  const scope = response.scope || READ_SCOPES
  const session: StoredSession = {
    access_token: response.access_token,
    // Refresh a minute early to avoid edge-of-expiry API failures.
    expires_at: Date.now() + expiresInSec * 1000 - 60_000,
    scope,
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  localStorage.setItem(REMEMBER_KEY, '1')
  applyScopes(scope)
}

function clearStoredToken(): void {
  localStorage.removeItem(SESSION_KEY)
}

function clearStoredSession(): void {
  clearStoredToken()
  localStorage.removeItem(REMEMBER_KEY)
}

function shouldRemember(): boolean {
  return localStorage.getItem(REMEMBER_KEY) === '1'
}

function restoreTokenFromStorage(): boolean {
  const session = readStoredSession()
  if (!session) return false
  if (Date.now() >= session.expires_at) {
    clearStoredToken()
    return false
  }
  gapi.client.setToken({ access_token: session.access_token })
  applyScopes(session.scope)
  return true
}

function stopTokenRefreshLoop(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

/**
 * While the tab stays open, quietly refresh before expiry (prompt: none).
 * Never opens a visible login UI — if Google needs interaction, we skip.
 */
function startTokenRefreshLoop(): void {
  stopTokenRefreshLoop()
  refreshTimer = setInterval(() => {
    void maybeRefreshTokenQuietly()
  }, REFRESH_CHECK_MS)
  void maybeRefreshTokenQuietly()
}

async function maybeRefreshTokenQuietly(): Promise<void> {
  const session = readStoredSession()
  if (!session) return
  const msLeft = session.expires_at - Date.now()
  if (msLeft > REFRESH_BEFORE_MS) return
  if (refreshInFlight) return

  refreshInFlight = (async () => {
    try {
      await initGoogle()
      const scope =
        [...grantedScopes].join(' ') || session.scope || READ_SCOPES
      // 'none' = fail silently if Google would need a popup / consent UI.
      await requestToken(scope, 'none')
      return true
    } catch {
      return false
    } finally {
      refreshInFlight = null
    }
  })()

  await refreshInFlight
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
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: getClientId(),
    scope: READ_SCOPES,
    callback: (response) => {
      tokenCallback?.(response)
    },
  })
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

function requestToken(
  scope: string,
  prompt?: string,
): Promise<google.accounts.oauth2.TokenResponse> {
  if (!tokenClient) {
    return Promise.reject(new Error('Google Identity Services not initialized'))
  }

  return new Promise((resolve, reject) => {
    tokenCallback = (response) => {
      tokenCallback = null
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
      persistSession(response)
      resolve(response)
    }
    tokenClient!.requestAccessToken({
      scope,
      prompt,
      include_granted_scopes: true,
    })
  })
}

/**
 * Restore a previous session after refresh / revisit.
 * Only uses a still-valid stored access token — never pops a login UI.
 * If the token expired, the user signs in again with the button.
 */
export function restoreSession(): Promise<boolean> {
  if (!restorePromise) {
    restorePromise = (async () => {
      await initGoogle()
      if (restoreTokenFromStorage()) {
        startTokenRefreshLoop()
        return true
      }
      return false
    })()
  }
  return restorePromise
}

/** Sign in with calendar read access (user-initiated only). */
export async function signIn(): Promise<void> {
  await initGoogle()
  // Returning users: skip full consent when Google still has the grant.
  const prompt = shouldRemember() || hasAccessToken() ? '' : 'consent'
  await requestToken(READ_SCOPES, prompt)
  restorePromise = Promise.resolve(true)
  startTokenRefreshLoop()
}

/** Request write scope (incremental) when committing tasks to a calendar. */
export async function ensureWriteScope(): Promise<void> {
  await initGoogle()
  if (grantedScopes.has(WRITE_SCOPE)) return
  await requestToken(`${READ_SCOPES} ${WRITE_SCOPE}`, 'consent')
  startTokenRefreshLoop()
}

export function signOut(): void {
  stopTokenRefreshLoop()
  const token = gapi.client.getToken()
  if (token?.access_token) {
    google.accounts.oauth2.revoke(token.access_token, () => {})
    gapi.client.setToken(null)
  }
  grantedScopes.clear()
  clearStoredSession()
  restorePromise = Promise.resolve(false)
}

export { READ_SCOPES, WRITE_SCOPE }
