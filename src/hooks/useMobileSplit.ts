import { useEffect, useState } from 'react'

const STORAGE_KEY = 'time-blocking.mobile-split'
const SPLIT_MIN = 18
const SPLIT_MAX = 72
const SPLIT_DEFAULT = 42

function loadSplit(): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY))
    if (Number.isFinite(n) && n >= SPLIT_MIN && n <= SPLIT_MAX) return n
  } catch {
    /* ignore */
  }
  return SPLIT_DEFAULT
}

export function clampMobileSplit(value: number): number {
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value))
}

export function useMobileSplit() {
  const [splitPercent, setSplitPercent] = useState(loadSplit)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(splitPercent))
    } catch {
      /* ignore */
    }
  }, [splitPercent])

  return {
    splitPercent,
    setSplitPercent,
    splitStyle: {
      ['--mobile-sidebar-size' as string]: `${splitPercent}%`,
    },
  }
}
