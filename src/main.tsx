import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { E2eHarness } from './e2eHarness'

// Drop the cache-bust param from "Reload app" so it doesn't linger in the URL.
const bootUrl = new URL(window.location.href)
if (bootUrl.searchParams.has('_reload')) {
  bootUrl.searchParams.delete('_reload')
  const cleaned =
    bootUrl.pathname +
    (bootUrl.searchParams.toString() ? `?${bootUrl.searchParams}` : '') +
    bootUrl.hash
  window.history.replaceState(null, '', cleaned || './')
}

const root = createRoot(document.getElementById('root')!)
root.render(
  <StrictMode>
    {import.meta.env.VITE_E2E === 'true' ? <E2eHarness /> : <App />}
  </StrictMode>,
)
