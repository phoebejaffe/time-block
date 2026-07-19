import { useEffect, useMemo, useRef, useState } from 'react'

type SettingsMenuProps = {
  busy?: boolean
  signedIn?: boolean
  onSignOut?: () => void
}

function formatBuildTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}

export function SettingsMenu({
  busy,
  signedIn,
  onSignOut,
}: SettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const buildTime = useMemo(() => formatBuildTime(__BUILD_TIME__), [])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (menuRef.current && !menuRef.current.contains(target)) {
        setOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className="settings-menu" ref={menuRef}>
      <button
        type="button"
        className="btn btn-text btn-icon"
        aria-label="Menu"
        aria-expanded={open}
        aria-haspopup="true"
        title="Menu"
        onClick={() => setOpen((v) => !v)}
      >
        <MenuIcon />
      </button>
      {open && (
        <div className="settings-menu-dropdown" role="menu">
          <div className="settings-menu-meta">
            <span className="settings-menu-meta-label">Built</span>
            <span className="settings-menu-meta-value">{buildTime}</span>
          </div>
          {signedIn && onSignOut && (
            <>
              <div className="calendar-menu-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="calendar-menu-item"
                disabled={busy}
                onClick={() => {
                  setOpen(false)
                  onSignOut()
                }}
              >
                Log out
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function MenuIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}
