import { useCallback, useEffect, useRef, useState } from 'react'
import { notice as makeNotice, type Notice, type NoticeKind } from '../lib/notice'

const AUTO_CLEAR_MS = 5_000

/**
 * Sidebar toast/notice helper. Success and info auto-clear;
 * errors stay until the next show/clear so they aren't missed.
 */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const clear = useCallback(() => {
    clearTimer()
    setNotice(null)
  }, [clearTimer])

  const show = useCallback(
    (kind: NoticeKind, text: string) => {
      clearTimer()
      const next = makeNotice(kind, text)
      setNotice(next)
      if (kind !== 'error') {
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          setNotice(null)
        }, AUTO_CLEAR_MS)
      }
    },
    [clearTimer],
  )

  useEffect(() => () => clearTimer(), [clearTimer])

  return { notice, show, clear }
}
