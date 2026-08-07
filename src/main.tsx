import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Drop the cache-bust param from "Reload App" so it doesn't linger in the URL.
const bootUrl = new URL(window.location.href)
if (bootUrl.searchParams.has('_reload')) {
  bootUrl.searchParams.delete('_reload')
  const cleaned =
    bootUrl.pathname +
    (bootUrl.searchParams.toString() ? `?${bootUrl.searchParams}` : '') +
    bootUrl.hash
  window.history.replaceState(null, '', cleaned || './')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
