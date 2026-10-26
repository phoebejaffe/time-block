import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { refreshAccessToken } from './google'

// .env supplies real Firebase config to tests — gate it off so a successful
// refresh doesn't fire a real signInWithCredential network call.
vi.mock('./firebase', () => ({
  isFirebaseConfigured: () => false,
  getFirebaseAuth: () => ({ currentUser: null }),
}))

const SESSION_KEY = 'time-blocking.google-session'

let fetchMock: Mock

function seedSession() {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      access_token: 'expired-access-token',
      expires_at: Date.now() - 60_000,
      scope:
        'openid email profile https://www.googleapis.com/auth/calendar.readonly',
      refresh_token: 'refresh-token-1',
    }),
  )
}

/** postAuth only reads ok/status/json — a plain object avoids happy-dom Response task tracking. */
function okResponse(accessToken = 'fresh-access-token'): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ access_token: accessToken, expires_in: 3600 }),
  } as Response
}

describe('refreshAccessToken', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = new Map()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value)
        },
        removeItem: (key: string) => {
          store.delete(key)
        },
        clear: () => {
          store.clear()
        },
      },
    })
    fetchMock = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', fetchMock)
    ;(globalThis as unknown as { gapi: unknown }).gapi = {
      client: { setToken: vi.fn() },
    }
    seedSession()
  })

  it('mints a real token on every call after the in-flight refresh settles', async () => {
    await expect(refreshAccessToken('timer')).resolves.toBe(true)
    await expect(refreshAccessToken('timer')).resolves.toBe(true)
    await expect(refreshAccessToken('timer')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('shares one in-flight refresh across concurrent callers', async () => {
    const results = await Promise.all([
      refreshAccessToken('timer'),
      refreshAccessToken('focus'),
      refreshAccessToken('retry'),
    ])
    expect(results).toEqual([true, true, true])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries the backend after a failed refresh instead of caching the failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'))

    await expect(refreshAccessToken('timer')).resolves.toBe(false)
    await expect(refreshAccessToken('timer')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not persist a session that was cleared while the refresh was in flight', async () => {
    let resolveFetch!: (res: Response) => void
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )

    const pending = refreshAccessToken('timer')
    localStorage.removeItem(SESSION_KEY)
    resolveFetch(okResponse())

    await expect(pending).resolves.toBe(false)
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('persists the new access token and applies it to gapi', async () => {
    await expect(refreshAccessToken('timer')).resolves.toBe(true)

    const stored = JSON.parse(localStorage.getItem(SESSION_KEY)!)
    expect(stored.access_token).toBe('fresh-access-token')
    expect(stored.refresh_token).toBe('refresh-token-1')
    expect(gapi.client.setToken).toHaveBeenCalledWith({
      access_token: 'fresh-access-token',
    })
  })
})
