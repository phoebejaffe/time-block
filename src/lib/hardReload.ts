/**
 * Bypass HTTP/disk caches and load a fresh document + asset graph.
 * Plain `location.reload()` often reuses a cached `index.html` (and thus
 * stale hashed JS/CSS) on GitHub Pages / mobile Safari.
 */
export async function hardReloadApp(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((reg) => reg.unregister()))
    }
  } catch {
    /* ignore */
  }

  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    }
  } catch {
    /* ignore */
  }

  const url = new URL(window.location.href)
  url.searchParams.set('_reload', String(Date.now()))
  // Full navigation with a unique query forces a network fetch of index.html,
  // which then pulls the current hashed JS/CSS bundle.
  window.location.replace(url.toString())
}
