import { useEffect, useState } from 'react'

const STORAGE_KEY = 'time-blocking.sidebar-width'
const WIDTH_MIN = 350
const WIDTH_MAX = 900
const WIDTH_DEFAULT = 380

function loadWidth(): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY))
    if (Number.isFinite(n) && n >= WIDTH_MIN && n <= WIDTH_MAX) return n
  } catch {
    /* ignore */
  }
  return WIDTH_DEFAULT
}

export function clampSidebarWidth(value: number, maxWidth?: number): number {
  const max = Math.max(
    WIDTH_MIN,
    Math.min(WIDTH_MAX, maxWidth ?? WIDTH_MAX),
  )
  return Math.min(max, Math.max(WIDTH_MIN, Math.round(value)))
}

export function useSidebarWidth() {
  const [sidebarWidth, setSidebarWidth] = useState(loadWidth)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(sidebarWidth))
    } catch {
      /* ignore */
    }
  }, [sidebarWidth])

  return {
    sidebarWidth,
    setSidebarWidth,
    sidebarStyle: {
      ['--sidebar-width' as string]: `${sidebarWidth}px`,
    },
  }
}
