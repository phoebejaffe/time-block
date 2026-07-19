import { useCallback, useEffect, useState } from 'react'
import { formatError } from '../lib/errors'
import {
  hasAccessToken,
  initGoogle,
  restoreSession,
  signIn as googleSignIn,
  signOut as googleSignOut,
} from '../lib/google'

export function useGoogleSession() {
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await initGoogle()
        const restored = await restoreSession()
        if (cancelled) return
        setSignedIn(restored || hasAccessToken())
        setReady(true)
      } catch (err) {
        if (cancelled) return
        setError(formatError(err))
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await googleSignIn()
      setSignedIn(true)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setBusy(false)
    }
  }, [])

  /** Returns false if the user cancelled the confirm dialog. */
  const signOut = useCallback((): boolean => {
    if (!window.confirm('Sign out of Google?')) return false
    googleSignOut()
    setSignedIn(false)
    setError(null)
    return true
  }, [])

  return {
    ready,
    signedIn,
    busy,
    error,
    setError,
    signIn,
    signOut,
  }
}
