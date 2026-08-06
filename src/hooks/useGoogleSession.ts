import { useCallback, useEffect, useState } from 'react'
import { formatError } from '../lib/errors'
import {
  getSessionDiagnostics,
  hasAccessToken,
  initGoogle,
  restoreSession,
  signIn as googleSignIn,
  signOut as googleSignOut,
  testRefreshNow,
  type SessionDiagnostics,
} from '../lib/google'

export function useGoogleSession() {
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testRefreshBusy, setTestRefreshBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<SessionDiagnostics>(() =>
    getSessionDiagnostics(),
  )

  const refreshDiagnostics = useCallback(() => {
    setDiagnostics(getSessionDiagnostics())
  }, [])

  useEffect(() => {
    const id = window.setInterval(refreshDiagnostics, 5_000)
    return () => window.clearInterval(id)
  }, [refreshDiagnostics])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await initGoogle()
        const restored = await restoreSession()
        if (cancelled) return
        refreshDiagnostics()
        setSignedIn(restored || hasAccessToken())
        setReady(true)
      } catch (err) {
        if (cancelled) return
        refreshDiagnostics()
        setError(formatError(err))
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshDiagnostics])

  const signIn = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await googleSignIn()
      refreshDiagnostics()
      setSignedIn(true)
    } catch (err) {
      refreshDiagnostics()
      setError(formatError(err))
    } finally {
      setBusy(false)
    }
  }, [refreshDiagnostics])

  const testRefresh = useCallback(async () => {
    setTestRefreshBusy(true)
    setError(null)
    try {
      const ok = await testRefreshNow()
      refreshDiagnostics()
      if (ok) {
        setSignedIn(true)
      } else {
        setError(
          getSessionDiagnostics().lastRefreshError ||
            'Refresh failed — see diagnostics below.',
        )
      }
    } catch (err) {
      refreshDiagnostics()
      setError(formatError(err))
    } finally {
      setTestRefreshBusy(false)
    }
  }, [refreshDiagnostics])

  /** Returns false if the user cancelled the confirm dialog. */
  const signOut = useCallback((): boolean => {
    if (!window.confirm('Sign out of Google?')) return false
    googleSignOut()
    refreshDiagnostics()
    setSignedIn(false)
    setError(null)
    return true
  }, [refreshDiagnostics])

  return {
    ready,
    signedIn,
    busy,
    testRefreshBusy,
    error,
    diagnostics,
    setError,
    signIn,
    signOut,
    testRefresh,
  }
}
